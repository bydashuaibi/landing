// 着陆 preload —— 保持 contextIsolation，前端不直接接触 Node。
// 如需后续把本地文件/系统能力安全暴露给前端，在此用 contextBridge 增加白名单 API。
window.addEventListener('DOMContentLoaded', () => {});
