<template>
  <main class="frame">
    <section class="pad">
      <AdminNav />
      <h1>{{ t('structure') }}</h1>
      <van-button type="primary" block :loading="busy" @click="onDefaults">{{ t('ensureDefaults') }}</van-button>
      <p v-if="message" class="hint">{{ message }}</p>
      <h2>{{ t('classes') }}</h2>
      <ul>
        <li v-for="item in classes" :key="item.id">{{ textOf(item.name, locale) }}</li>
      </ul>
      <van-form @submit="onClass">
        <van-field v-model="className" :label="t('className')" required />
        <div class="pad-btn">
          <van-button block type="primary" native-type="submit">{{ t('addClass') }}</van-button>
        </div>
      </van-form>
      <h2>{{ t('subjects') }}</h2>
      <ul class="codes">
        <li v-for="subject in subjects" :key="subject.id">{{ subject.code }} · {{ textOf(subject.name, locale) }}</li>
      </ul>
      <p v-if="error" class="error">{{ error }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FUNCTIONS } from '@hst/shared';
import { callFunction, textOf, type I18nText } from '../../api';
import AdminNav from './AdminNav.vue';

interface Named { id: string; name: I18nText }
interface Subject extends Named { code: string }
interface Structure { classes: Named[]; subjects: Subject[]; years: Array<{ id: string; isCurrent: boolean }> }

const { t, locale } = useI18n();
const classes = ref<Named[]>([]);
const subjects = ref<Subject[]>([]);
const yearId = ref('');
const className = ref('');
const error = ref('');
const message = ref('');
const busy = ref(false);

async function load() {
  const result = await callFunction<Structure>(FUNCTIONS.apiAdmin, 'admin.structure.list');
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  classes.value = result.data.classes;
  subjects.value = result.data.subjects;
  yearId.value = result.data.years.find((year) => year.isCurrent)?.id ?? result.data.years[0]?.id ?? '';
}

async function onDefaults() {
  busy.value = true;
  error.value = '';
  const result = await callFunction<{ created: number }>(FUNCTIONS.apiAdmin, 'admin.subject.ensureDefaults');
  busy.value = false;
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  message.value = t('saved');
  await load();
}

async function onClass() {
  error.value = '';
  const result = await callFunction<{ id: string }>(FUNCTIONS.apiAdmin, 'admin.class.upsert', {
    yearId: yearId.value,
    programme: 'MYP',
    name: { zh: className.value, en: className.value },
  });
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  className.value = '';
  await load();
}

onMounted(load);
</script>

<style scoped>
.codes, ul { padding-left: 18px; }
.pad-btn { margin: 12px 0; }
h1 { font-size: 22px; }
h2 { font-size: 16px; margin-top: 18px; }
</style>
