<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

interface Suggestion {
  id: string;
  name: string;
  slug: string;
}

const props = withDefaults(
  defineProps<{
    categoryId: string;
    categorySlug: string;
    initialNames?: string[];
    initialNote?: string;
    editing?: boolean;
  }>(),
  { initialNames: () => ['', '', ''], initialNote: '', editing: false },
);

const names = ref<string[]>([
  props.initialNames[0] ?? '',
  props.initialNames[1] ?? '',
  props.initialNames[2] ?? '',
]);
const note = ref(props.initialNote);

const suggestions = ref<Suggestion[]>([]);
const openSlot = ref<number | null>(null);
const activeIndex = ref(-1);
const submitting = ref(false);
const error = ref('');

const inputRefs = ref<HTMLInputElement[]>([]);
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let requestSeq = 0;

/**
 * Mirrors the SQL slugify(): lowercase, strip a leading article, collapse
 * everything non-alphanumeric. Only used to spot duplicates before submitting
 * -- the database remains the authority.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const filled = computed(() => names.value.filter((n) => slugify(n)).length);

const duplicate = computed(() => {
  const slugs = names.value.map(slugify).filter(Boolean);
  return new Set(slugs).size !== slugs.length;
});

const canSubmit = computed(
  () => filled.value === 3 && !duplicate.value && !submitting.value,
);

async function fetchSuggestions(slot: number, term: string) {
  const seq = ++requestSeq;
  if (!term.trim()) {
    suggestions.value = [];
    return;
  }

  try {
    const url = new URL('/api/items/search', window.location.origin);
    url.searchParams.set('category', props.categoryId);
    url.searchParams.set('q', term);

    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return;

    const body = (await res.json()) as { items: Suggestion[] };
    // Drop responses that lost the race to a newer keystroke.
    if (seq !== requestSeq || openSlot.value !== slot) return;

    // Don't suggest something already used in another slot.
    const taken = new Set(
      names.value.map(slugify).filter((s, i) => s && i !== slot),
    );
    suggestions.value = body.items.filter((item) => !taken.has(item.slug));
    activeIndex.value = -1;
  } catch {
    // A failed lookup just means no suggestions; typing still works.
  }
}

function onInput(slot: number, value: string) {
  names.value[slot] = value;
  openSlot.value = slot;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fetchSuggestions(slot, value), 180);
}

function choose(slot: number, suggestion: Suggestion) {
  names.value[slot] = suggestion.name;
  closeList();
  nextTick(() => inputRefs.value[slot]?.focus());
}

// A click on a suggestion fires blur before mousedown resolves; the delay
// keeps the list alive long enough for the choice to land.
function onBlur() {
  setTimeout(closeList, 120);
}

function closeList() {
  openSlot.value = null;
  suggestions.value = [];
  activeIndex.value = -1;
}

function onKeydown(slot: number, event: KeyboardEvent) {
  if (openSlot.value !== slot || suggestions.value.length === 0) {
    if (event.key === 'Escape') closeList();
    return;
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      activeIndex.value = (activeIndex.value + 1) % suggestions.value.length;
      break;
    case 'ArrowUp':
      event.preventDefault();
      activeIndex.value =
        activeIndex.value <= 0 ? suggestions.value.length - 1 : activeIndex.value - 1;
      break;
    case 'Enter':
      if (activeIndex.value >= 0) {
        event.preventDefault();
        choose(slot, suggestions.value[activeIndex.value]!);
      }
      break;
    case 'Escape':
      closeList();
      break;
  }
}

watch(duplicate, (isDupe) => {
  if (isDupe) error.value = 'The same thing cannot appear twice in one TopThree.';
  else if (error.value.startsWith('The same thing')) error.value = '';
});

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  error.value = '';

  try {
    const res = await fetch('/api/top-three', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        categoryId: props.categoryId,
        names: names.value.map((n) => n.trim()),
        note: note.value.trim() || null,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as { error?: string };

    if (!res.ok) {
      error.value = body.error ?? 'Something went wrong. Try again.';
      submitting.value = false;
      return;
    }

    window.location.href = `/c/${props.categorySlug}`;
  } catch {
    error.value = 'Could not reach the server. Check your connection.';
    submitting.value = false;
  }
}
</script>

<template>
  <form class="editor" @submit.prevent="submit">
    <ol class="slots">
      <li v-for="(_, slot) in names" :key="slot" class="slot">
        <span :class="['rank', `rank-${slot + 1}`]" aria-hidden="true">{{ slot + 1 }}</span>

        <div class="field">
          <label class="visually-hidden" :for="`slot-${slot}`">
            Number {{ slot + 1 }}
          </label>
          <input
            :id="`slot-${slot}`"
            :ref="(el) => { if (el) inputRefs[slot] = el as HTMLInputElement }"
            type="text"
            autocomplete="off"
            role="combobox"
            aria-autocomplete="list"
            :aria-expanded="openSlot === slot && suggestions.length > 0"
            :aria-controls="`suggestions-${slot}`"
            :aria-activedescendant="
              openSlot === slot && activeIndex >= 0 ? `option-${slot}-${activeIndex}` : undefined
            "
            :placeholder="slot === 0 ? 'Your number one…' : `Number ${slot + 1}…`"
            :value="names[slot]"
            maxlength="120"
            @input="onInput(slot, ($event.target as HTMLInputElement).value)"
            @keydown="onKeydown(slot, $event)"
            @blur="onBlur"
          />

          <ul
            v-if="openSlot === slot && suggestions.length > 0"
            :id="`suggestions-${slot}`"
            class="suggestions"
            role="listbox"
          >
            <li
              v-for="(item, i) in suggestions"
              :id="`option-${slot}-${i}`"
              :key="item.id"
              role="option"
              :aria-selected="i === activeIndex"
              :class="{ active: i === activeIndex }"
              @mousedown.prevent="choose(slot, item)"
              @mouseenter="activeIndex = i"
            >
              {{ item.name }}
            </li>
          </ul>
        </div>
      </li>
    </ol>

    <p class="small muted hint">
      Pick from the suggestions where you can &mdash; it keeps everyone&rsquo;s
      votes counting towards the same thing.
    </p>

    <label class="note-label" for="note">
      A line on why <span class="muted">(optional)</span>
    </label>
    <textarea id="note" v-model="note" rows="2" maxlength="280" />

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="actions">
      <button type="submit" class="btn btn-primary" :disabled="!canSubmit">
        {{ submitting ? 'Saving…' : editing ? 'Update my TopThree' : 'Post my TopThree' }}
      </button>
      <span v-if="filled < 3" class="small muted">
        {{ 3 - filled }} to go
      </span>
    </div>
  </form>
</template>

<style scoped>
.slots {
  list-style: none;
  margin: 0 0 0.5rem;
  padding: 0;
}

.slot {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.slot + .slot { margin-top: 0.6rem; }

.field {
  position: relative;
  flex: 1;
  min-width: 0;
}

.suggestions {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
  max-height: 14rem;
  overflow-y: auto;
}

.suggestions li {
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  cursor: pointer;
}
.suggestions li.active { background: var(--accent-soft); }

.hint { margin: 0.75rem 0 1rem; }

.note-label {
  display: block;
  font-size: 0.9rem;
  font-weight: 550;
  margin-bottom: 0.35rem;
}

.error {
  margin: 0.75rem 0 0;
  color: #b3261e;
  font-size: 0.9rem;
}
@media (prefers-color-scheme: dark) {
  .error { color: #f2b8b5; }
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
}
</style>
