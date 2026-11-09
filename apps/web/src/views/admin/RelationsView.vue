<template>
  <main class="frame">
    <section class="pad">
      <AdminNav />
      <h1>{{ t('relations') }}</h1>
      <h2>Guardianship</h2>
      <van-form @submit="onGuardian">
        <van-field v-model="parentId" label="parentId" required />
        <van-field v-model="studentId" label="studentId" required />
        <div class="pad-btn"><van-button block type="primary" native-type="submit">{{ t('saved') }}</van-button></div>
      </van-form>
      <h2>Teaching</h2>
      <van-form @submit="onTeaching">
        <van-field v-model="teacherId" label="teacherId" required />
        <van-field v-model="courseId" label="courseId" required />
        <div class="pad-btn"><van-button block type="primary" native-type="submit">{{ t('saved') }}</van-button></div>
      </van-form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="message" class="hint">{{ message }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FUNCTIONS } from '@hst/shared';
import { callFunction } from '../../api';
import AdminNav from './AdminNav.vue';

const { t } = useI18n();
const parentId = ref('');
const studentId = ref('');
const teacherId = ref('');
const courseId = ref('');
const error = ref('');
const message = ref('');

async function onGuardian() {
  error.value = '';
  const result = await callFunction(FUNCTIONS.apiAdmin, 'admin.relation.upsert', {
    kind: 'guardianship',
    parentId: parentId.value.trim(),
    studentId: studentId.value.trim(),
    relation: 'guardian',
    isPrimary: true,
  });
  if (!result.ok) error.value = result.error.message;
  else message.value = t('saved');
}

async function onTeaching() {
  error.value = '';
  const result = await callFunction(FUNCTIONS.apiAdmin, 'admin.relation.upsert', {
    kind: 'teaching',
    teacherId: teacherId.value.trim(),
    courseId: courseId.value.trim(),
    role: 'lead',
  });
  if (!result.ok) error.value = result.error.message;
  else message.value = t('saved');
}
</script>

<style scoped>
h1 { font-size: 22px; }
h2 { font-size: 16px; }
.pad-btn { margin: 12px 0 18px; }
</style>
