export default {
  server: {
    allowedHosts: [".", "localhost", "api.aklab.ti-soft.ru", "aklab.ti-soft.ru", "127.0.0.1"],
  },
  preview: {
    allowedHosts: [".", "localhost", "api.aklab.ti-soft.ru", "aklab.ti-soft.ru", "127.0.0.1"]
  },
  build: {
    rollupOptions: {
      external: ['vite']
    }
  }
};
