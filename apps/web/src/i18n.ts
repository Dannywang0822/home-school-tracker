import { createI18n } from 'vue-i18n';

const zh = {
  brand: '家校联络',
  programme: 'IB MYP / DP',
  loginTitle: '登录',
  passwordTab: '邮箱密码',
  codeTab: '邮箱验证码',
  email: '邮箱',
  password: '密码',
  code: '验证码',
  sendCode: '获取验证码',
  codeSent: '如果邮箱已登记，验证码会发到本地服务日志。',
  signIn: '登录',
  signingIn: '正在登录…',
  privacy: '隐私政策',
  language: '语言',
  logout: '退出',
  home: '首页',
  school: '学校',
  roles: '角色',
  children: '我的孩子',
  noChildren: '还没有绑定孩子。请向学校索取邀请码。',
  pendingConsent: '有孩子尚未完成知情同意，业务功能会暂时关闭。',
  weekNote: '第 1 周已接通身份和权限。任务、成绩和消息页面在后续迭代。',
  firstLogin: '首次登录请设置新密码',
  newPassword: '新密码',
  savePassword: '保存',
  passwordHint: '8–32 位，至少包含大写、小写、数字、符号中的三类。正式环境会先调用 CloudBase 修改密码。',
  passwordInvalid: '密码不符合要求',
  passwordSaved: '已记录。正式环境还会同步到 CloudBase 登录密码。',
  demoHint: '本地演示账号，不是真实学生。密码：',
  role: {
    teacher: '老师',
    student: '学生',
    parent: '家长',
    cas_coordinator: 'CAS 协调员',
    ee_coordinator: 'EE 协调员',
    supervisor: '导师',
    admin: '管理员',
    ops_mailer: '发件',
  },
};

const en = {
  brand: 'Home & School',
  programme: 'IB MYP / DP',
  loginTitle: 'Sign in',
  passwordTab: 'Email and password',
  codeTab: 'Email code',
  email: 'Email',
  password: 'Password',
  code: 'Code',
  sendCode: 'Send code',
  codeSent: 'If the address is registered, the code is printed in the local server log.',
  signIn: 'Sign in',
  signingIn: 'Signing in…',
  privacy: 'Privacy',
  language: 'Language',
  logout: 'Sign out',
  home: 'Home',
  school: 'School',
  roles: 'Roles',
  children: 'My children',
  noChildren: 'No child is linked yet. Ask the school for an invite code.',
  pendingConsent: 'Consent is still required, so academic features stay closed.',
  weekNote: 'Week 1 connects identity and access control. Tasks, grades and messages come next.',
  firstLogin: 'Choose a new password',
  newPassword: 'New password',
  savePassword: 'Save',
  passwordHint: '8–32 characters, at least three of uppercase, lowercase, digits and symbols. Production changes the CloudBase password first.',
  passwordInvalid: 'Password does not meet the rules',
  passwordSaved: 'Saved. Production also updates the CloudBase password.',
  demoHint: 'Local demo accounts, not real students. Password:',
  role: {
    teacher: 'Teacher',
    student: 'Student',
    parent: 'Parent',
    cas_coordinator: 'CAS coordinator',
    ee_coordinator: 'EE coordinator',
    supervisor: 'Supervisor',
    admin: 'Admin',
    ops_mailer: 'Mailer',
  },
};

export type MessageSchema = typeof zh;

export const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('hst.locale') === 'en' ? 'en' : 'zh',
  fallbackLocale: 'zh',
  messages: { zh, en },
});

export function currentLocale(): 'zh' | 'en' {
  return i18n.global.locale.value === 'en' ? 'en' : 'zh';
}

export function setLocale(locale: 'zh' | 'en'): void {
  i18n.global.locale.value = locale;
  localStorage.setItem('hst.locale', locale);
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
}
