import { defineStore } from 'pinia';
import { clearToken, devLogin, loadMe, sendEmailCode, setToken, verifyEmailCode, type Me } from '../api';

export const useSession = defineStore('session', {
  state: () => ({
    token: '',
    me: null as Me | null,
    ready: false,
  }),
  actions: {
    restore() {
      this.token = sessionStorage.getItem('hst.token') ?? '';
      this.ready = true;
    },
    async loginWithPassword(email: string, password: string) {
      const result = await devLogin(email, password);
      if (!result.ok) return result;
      setToken(result.data.token);
      this.token = result.data.token;
      return this.refresh();
    },
    async requestCode(email: string) {
      return sendEmailCode(email);
    },
    async loginWithCode(email: string, code: string) {
      const result = await verifyEmailCode(email, code);
      if (!result.ok) return result;
      setToken(result.data.token);
      this.token = result.data.token;
      return this.refresh();
    },
    async refresh() {
      const result = await loadMe();
      if (!result.ok) {
        this.logout();
        return result;
      }
      this.me = result.data;
      return result;
    },
    logout() {
      clearToken();
      this.token = '';
      this.me = null;
    },
  },
});
