<template>
  <nav class="admin-nav">
    <router-link to="/a">{{ t('structure') }}</router-link>
    <router-link to="/a/import">{{ t('importData') }}</router-link>
    <router-link to="/a/relations">{{ t('relations') }}</router-link>
    <router-link to="/a/invites">{{ t('invites') }}</router-link>
    <router-link to="/a/consents">{{ t('consentReport') }}</router-link>
    <router-link to="/home">{{ t('home') }}</router-link>
  </nav>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<style scoped>
.admin-nav {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 12px;
}
.admin-nav a {
  flex: 0 0 auto;
  text-decoration: none;
  border: 1px solid var(--hst-line);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 14px;
}
.admin-nav a.router-link-active {
  background: var(--hst-green);
  color: white;
  border-color: var(--hst-green);
}
</style>
