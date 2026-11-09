<template>
  <main class="frame">
    <section class="pad plan">
      <p><router-link to="/login">{{ t('loginTitle') }}</router-link></p>
      <div class="lang">
        <button type="button" :aria-pressed="locale === 'zh'" @click="setLocale('zh')">中文</button>
        <button type="button" :aria-pressed="locale === 'en'" @click="setLocale('en')">EN</button>
      </div>
      <h1>{{ t('planTitle') }}</h1>
      <p class="hint">{{ t('planIntro') }}</p>
      <p class="hint">{{ t('planUpdated') }} {{ updated }}（Asia/Shanghai）</p>

      <h2>{{ t('currentWork') }}</h2>
      <article class="card">
        <p><span :class="statusClass(current.status)">{{ t(`status.${current.status}`) }}</span> {{ text(current).title }}</p>
        <p><strong>{{ t('goal') }}</strong> {{ text(current).goal }}</p>
        <p><strong>{{ t('delivery') }}</strong> {{ text(current).delivery }}</p>
        <p>{{ text(current).note }}</p>
      </article>

      <h2>{{ t('weekPlan') }}</h2>
      <article v-for="week in weeks" :key="week.id" class="card">
        <h3>{{ week.id }} · {{ text(week).title }}</h3>
        <p><span :class="statusClass(week.status)">{{ t(`status.${week.status}`) }}</span> {{ week.updated }}</p>
        <p><strong>{{ t('goal') }}</strong> {{ text(week).goal }}</p>
        <p><strong>{{ t('delivery') }}</strong> {{ text(week).delivery }}</p>
        <p>{{ text(week).note }}</p>
      </article>

      <h2>{{ t('demoAccounts') }}</h2>
      <p>{{ t('demoHint') }} DemoOnly-2026!</p>
      <ul>
        <li>a1@demo.school.local · {{ t('role.admin') }}</li>
        <li>t1@demo.school.local · {{ t('role.teacher') }}</li>
        <li>s1@demo.school.local · {{ t('role.student') }}</li>
        <li>p1@demo.school.local · {{ t('role.parent') }}</li>
        <li>minor@demo.school.local · {{ t('role.student') }}</li>
      </ul>

      <h2>{{ t('localRun') }}</h2>
      <pre>npm ci
npm test
npm run dev</pre>
      <p class="hint">http://127.0.0.1:5173</p>

      <h2>{{ t('deviations') }}</h2>
      <ul>
        <li v-for="(item, index) in deviationItems" :key="index">{{ item }}</li>
      </ul>

      <h2>{{ t('safety') }}</h2>
      <ul>
        <li v-for="(item, index) in safetyItems" :key="index">{{ item }}</li>
      </ul>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { setLocale } from '../i18n';
import { CURRENT_WORK, PLAN_UPDATED, WEEKS, type WeekPlan, type WeekStatus } from '../plan/weeks';

const { t, locale } = useI18n();
const weeks = WEEKS;
const current = CURRENT_WORK;
const updated = PLAN_UPDATED;
const lang = computed(() => (locale.value === 'en' ? 'en' : 'zh'));

function text(item: { zh: WeekPlan['zh']; en: WeekPlan['en'] }) {
  return lang.value === 'en' ? item.en : item.zh;
}

function statusClass(status: WeekStatus): string {
  return `badge ${status}`;
}

const deviationItems = computed(() =>
  lang.value === 'en'
    ? [
        'Collections, functions and storage paths use the hst_ prefix because the CloudBase environment is shared.',
        'Nothing has been deployed to Tencent Cloud. There are no CAM keys in the repository.',
        'CSV import submits text. CreateUser is local. Task files use an in-memory storage adapter.',
        'Overdue calculation does not send mail or in-app notifications yet.',
        'The GitHub Pages build runs the same permission code in the browser. Refreshing restores the initial fictional school.',
        'Week 4 and later are paused.',
      ]
    : [
        '集合、云函数和存储路径都加了 hst_ 前缀，因为 CloudBase 环境与其他应用共用。',
        '还没有部署到腾讯云。仓库里没有 CAM 密钥。',
        'CSV 直接提交文本。CreateUser 在本地建号。任务附件用内存存储适配器。',
        '逾期计算还不发邮件或站内通知。',
        'GitHub Pages 上的页面在浏览器里跑同一套权限代码。刷新会恢复最初的虚构学校数据。',
        '第 4 周及以后暂缓。',
      ],
);

const safetyItems = computed(() =>
  lang.value === 'en'
    ? [
        'The repository is public. Do not commit secrets, private keys, or real student records.',
        'Credentials are read from environment variables. .env.example lists names only.',
        'Demo people use fictional names and @demo.school.local addresses.',
        'There is no public page of student data. The static demo is still a demo, not a school system.',
      ]
    : [
        '仓库是公开的。不要提交密钥、私钥或真实学生资料。',
        '凭据只从环境变量读取。.env.example 只列变量名。',
        '演示人物使用虚构姓名和 @demo.school.local 邮箱。',
        '没有公开的学生数据页。静态演示仍然只是演示，不是学校正式系统。',
      ],
);
</script>

<style scoped>
.plan h1 { font-size: 26px; }
.plan h2 { font-size: 18px; margin-top: 22px; }
.plan h3 { font-size: 16px; margin: 0 0 6px; }
.card { border-top: 1px solid var(--hst-line); padding: 12px 0; }
.badge { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 12px; margin-right: 6px; }
.done { background: #e5f4ec; color: #164c35; }
.in_progress { background: #f4ead2; color: #6a4b12; }
.paused { background: #f3e4e4; color: #6d2d2d; }
.planned { background: #eceff3; color: #2c3644; }
pre { background: #f7f4ec; padding: 10px; overflow: auto; }
</style>
