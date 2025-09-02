// src/types/express.d.ts

// 這一行是為了確保我們是在擴充 Express 模組，而不是建立一個新的
import 'express';

// 使用 'declare global' 來告訴 TypeScript 我們要修改全域可用的模組
declare global {
  // 進入 Express 的命名空間
  namespace Express {
    // 找到並擴充 Request 介面
    interface Request {
      // 在這裡加上我們自訂的屬性
      // 使用 '?' 讓它成為可選屬性，因為並不是所有請求都會有 rawBody
      rawBody?: string;
    }
  }
}