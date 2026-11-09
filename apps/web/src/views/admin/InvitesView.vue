<template>
  <main class="frame">
    <section class="pad">
      <AdminNav />
      <h1>{{ t('invites') }}</h1>
      <van-form @submit="onCreate">
        <van-field v-model="studentId" label="studentId" required />
        <div class="pad-btn"><van-button block type="primary" native-type="submit">{{ t('createInvite') }}</van-button></div>
      </van-form>
      <p v-if="code" class="banner">{{ t('inviteOnce') }} {{ code }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <ul>
        <li v-for="item in items" :key="item.inviteId">{{ item.studentId }} · {{ item.status }}</li>
      </ul>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { FUNCTIONS } from '@hst/shared';
import { callFunction } from '../../api';
import AdminNav from './AdminNav.vue';

const { t } = useI18n();
const studentId = ref('');
const code = ref('');
const error = ref('');
const items = ref<Array<{ inviteId: string; studentId: string; status: string }>>([]);

async function load() {
  const result = await callFunction<{ items: typeof items.value }>(FUNCTIONS.apiAdmin, 'admin.invite.list');
  if (result.ok) items.value = result.data.items;
}

async function onCreate() {
  error.value = '';
  code.value = '';
  const result = await callFunction<{ code: string }>(FUNCTIONS.apiAdmin, 'admin.invite.create', {
    studentId: studentId.value.trim(),
    relation: 'guardian',
  });
  if (!result.ok) {
    error.value = result.error.message;
    return;
  }
  code.value = result.data.code;
  await load();
}

onMounted(load);
</script>

<style scoped>
h1 { font-size: 22px; }
.pad-btn { margin: 12px 0; }
</style>
