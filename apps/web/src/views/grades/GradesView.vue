<template>
  <main class="frame">
    <section class="pad">
      <p><router-link to="/home">{{ t('home') }}</router-link></p>
      <h1>{{ t('grades') }}</h1>
      <div class="lang">
        <button v-for="child in children" :key="child.studentId" type="button" :aria-pressed="child.studentId === studentId" @click="studentId = child.studentId">
          {{ textOf(child.displayName, locale) }}
        </button>
      </div>
      <article v-for="block in blocks" :key="`${block.termId}-${block.subject.subjectId}`" class="card">
        <h2>{{ block.subject.subjectId }}</h2>
        <p class="hint">{{ block.termId }}</p>
        <p v-if="block.subject.myp">
          A {{ level(block.subject.myp, 'A') }} · B {{ level(block.subject.myp, 'B') }} · C {{ level(block.subject.myp, 'C') }} · D {{ level(block.subject.myp, 'D') }}
        </p>
        <p v-if="block.subject.myp">{{ t('termGrade') }} {{ overrideGrade(block.subject) ?? block.subject.myp.grade }} / {{ t('bestFit') }} {{ block.subject.myp.total }}</p>
        <p v-if="block.subject.dp">DP {{ block.subject.dp.predicted }}</p>
        <p v-if="block.subject.dp" class="hint">{{ t('iaStub') }}<span v-if="block.subject.ia"> {{ block.subject.ia.score }}</span></p>
        <p v-if="block.subject.teacherOverride">{{ block.subject.teacherOverride.comment }}</p>
        <svg v-if="series(block.subject.subjectId).length > 1" viewBox="0 0 240 80" class="chart" role="img">
          <polyline :points="line(block.subject.subjectId)" fill="none" stroke="#1f4b3a" stroke-width="2" />
        </svg>
      </article>
      <h2>{{ t('releasedComment') }}</h2>
      <article v-for="item in items" :key="item.taskId" class="card">
        <h3>{{ item.taskTitle }}</h3>
        <p v-if="item.myp">A {{ item.myp.A?.level ?? '–' }} · B {{ item.myp.B?.level ?? '–' }} · C {{ item.myp.C?.level ?? '–' }} · D {{ item.myp.D?.level ?? '–' }}</p>
        <p v-if="item.dp">{{ item.dp.score }}</p>
        <p>{{ item.overallComment }}</p>
      </article>
      <p v-if="!items.length" class="note">{{ t('noGrade') }}</p>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { textOf, callFunction } from '../../api';
import { FUNCTIONS } from '@hst/shared';
import { useSession } from '../../stores/session';

interface SummarySubject {
  subjectId: string;
  myp?: { A?: { bestFit?: number }; B?: { bestFit?: number }; C?: { bestFit?: number }; D?: { bestFit?: number }; total?: number; grade?: number };
  dp?: { predicted?: number };
  ia?: { score?: number };
  teacherOverride?: { grade?: number; comment?: string };
}

const { t, locale } = useI18n();
const session = useSession();
const children = computed(() => session.me?.children ?? []);
const studentId = ref(session.me?.user.studentId ?? session.me?.children[0]?.studentId ?? '');
const blocks = ref<Array<{ termId: string; subject: SummarySubject }>>([]);
const growth = ref<Record<string, Record<string, { termId: string; level: number }[]>>>({});
const items = ref<Array<{ taskId: string; taskTitle?: string; overallComment?: string; myp?: Record<string, { level?: number }>; dp?: { score?: number } }>>([]);
const error = ref('');

function level(myp: SummarySubject['myp'], key: 'A' | 'B' | 'C' | 'D'): string {
  const value = myp?.[key]?.bestFit;
  return value == null ? '–' : String(value);
}

function overrideGrade(subject: SummarySubject): number | undefined {
  return subject.teacherOverride?.grade;
}

function series(subjectId: string): { termId: string; level: number }[] {
  const bucket = growth.value[subjectId];
  if (!bucket) return [];
  return bucket.A ?? bucket.predicted ?? [];
}

function line(subjectId: string): string {
  const points = series(subjectId);
  if (points.length === 0) return '';
  return points
    .map((point, index) => {
      const x = points.length === 1 ? 20 : 20 + (index * 200) / (points.length - 1);
      const y = 70 - (point.level / 8) * 60;
      return `${x},${y}`;
    })
    .join(' ');
}

async function load() {
  if (!studentId.value) return;
  const summary = await callFunction<{ terms: { termId: string; subjects: SummarySubject[] }[]; growth: typeof growth.value }>(FUNCTIONS.apiAcademic, 'summary.get', {
    studentId: studentId.value,
  });
  if (!summary.ok) {
    error.value = summary.error.message;
    return;
  }
  blocks.value = summary.data.terms.flatMap((term) => term.subjects.map((subject) => ({ termId: term.termId, subject })));
  growth.value = summary.data.growth;
  const listed = await callFunction<{ items: typeof items.value }>(FUNCTIONS.apiAcademic, 'assessment.listByStudent', { studentId: studentId.value });
  if (listed.ok) items.value = listed.data.items;
}

watch(studentId, load);
onMounted(load);
</script>

<style scoped>
.card { border-top: 1px solid var(--hst-line); padding: 10px 0; }
.chart { width: 100%; height: 80px; background: #f7f4ec; }
</style>
