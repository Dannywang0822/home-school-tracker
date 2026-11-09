<template>
  <main class="frame">
    <van-nav-bar :title="t('privacy')" left-arrow @click-left="router.back()" />
    <article class="pad">
      <h1>{{ t('brand') }}</h1>
      <p v-if="locale === 'zh'">
        这是隐私政策占位文本，等待学校法务审定。页面不展示任何学生个人信息。
        平台只保存教学联络所需的最少信息，不采集证件号、住址、出生日期或照片。
        除登录页和本页外，没有可以匿名访问的页面。
      </p>
      <p v-else>
        This privacy text is a placeholder until the school reviews it. It contains no student information.
        The platform keeps only the minimum needed for school communication and does not collect ID numbers,
        addresses, dates of birth or photos. Nothing except sign-in and this page is available without an account.
      </p>
      <p><router-link to="/login">{{ t('loginTitle') }}</router-link></p>
    </article>
  </main>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const { t, locale } = useI18n();
const router = useRouter();
</script>
