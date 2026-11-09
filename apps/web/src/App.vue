<template>
  <p v-if="staticDemo" class="demo-banner">
    {{ t('staticDemo') }}
    <router-link to="/plan">{{ t('plan') }}</router-link>
  </p>
  <router-view />
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { isStaticDemo } from './demo/engine';

const { t } = useI18n();
const staticDemo = isStaticDemo();
</script>

<style>
.demo-banner {
  margin: 0;
  padding: 10px 16px;
  background: #f4ead2;
  color: #3d3422;
  font-size: 14px;
  line-height: 1.45;
}
.demo-banner a { margin-left: 8px; }
</style>
