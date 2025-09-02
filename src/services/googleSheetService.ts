// src/services/googleSheetService.ts

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// 定義 User 物件的型別，方便後續使用
export interface User {
  id: number;
  line_user_id: string;
  state_json: string | null;
}

export interface LearningObjective {
  objective_id: number;
  user_id: number;
  title: string;
  status: 'In Progress' | 'Completed' | 'On Hold';
  due_date: string | null;
  gcal_event_ids: string | null;
}

export class GoogleSheetService {
  private sheets;
  private spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  // 接收從外部傳入的認證物件，保持一致性
  constructor(auth: OAuth2Client) {
    this.sheets = google.sheets({ version: 'v4', auth });
  }
  /**
   * ✨ 新方法 1：建立一個新的學習目標
   */
  async createLearningObjective(userId: number, title: string, dueDate: string | null = null): Promise<LearningObjective> {
    const range = 'LearningObjectives!A:F';
    const response = await this.sheets.spreadsheets.values.get({ spreadsheetId: this.spreadsheetId, range: 'LearningObjectives!A:A' });
    const newObjectiveId = (response.data.values ? response.data.values.length : 0) + 100; // 從 101 開始編號

    const newRow = [
      newObjectiveId, // objective_id
      userId,         // user_id
      title,          // title
      'In Progress',  // status (預設)
      dueDate || '',  // due_date
      ''              // gcal_event_ids (初始為空)
    ];

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [newRow] },
    });

    console.log(`[DB] 已為使用者 ${userId} 建立新目標 #${newObjectiveId}: ${title}`);
    return {
      objective_id: newObjectiveId,
      user_id: userId,
      title: title,
      status: 'In Progress',
      due_date: dueDate,
      gcal_event_ids: null
    };
  }

  /**
   * ✨ 新方法 2：將一個 Google Calendar 事件 ID 關聯到一個學習目標
   */
  async linkEventToObjective(objectiveId: number, eventId: string): Promise<void> {
    const range = 'LearningObjectives!A:F';
    const response = await this.sheets.spreadsheets.values.get({ spreadsheetId: this.spreadsheetId, range: range });
    const rows = response.data.values || [];

      for (let i = 1; i < rows.length; i++) {
        if (parseInt(rows[i][0]) === objectiveId) {
          const rowNumber = i + 1;
          const currentEventIds = rows[i][5] || ''; // 取得 F 欄的現有值
          const newEventIds = currentEventIds ? `${currentEventIds},${eventId}` : eventId;

          const updateRange = `LearningObjectives!F${rowNumber}`;
          await this.sheets.spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId,
            range: updateRange,
            valueInputOption: 'RAW',
            requestBody: { values: [[newEventIds]] },
          });
          
          console.log(`[DB] 已將事件 ${eventId} 關聯到目標 #${objectiveId}`);
          return;
        }
      }
      console.error(`[DB] 關聯失敗：找不到目標 #${objectiveId}`);
    }

  /**
   * 根據 line_user_id 尋找或建立一個使用者。
   * @returns 回傳包含列號和使用者資料的物件。
   */
  async findOrCreateUser(lineUserId: string): Promise<{ rowNumber: number; user: User }> {
    const range = 'Users!A:D'; // 讀取 Users 分頁的 A 到 D 欄
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: range,
    });

    const rows = response.data.values || [];
    // 從第二行開始尋找 (跳過標題)
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][1] === lineUserId) { // Column B is line_user_id
        console.log(`[DB] 找到使用者: ${lineUserId} at row ${i + 1}`);
        return {
          rowNumber: i + 1,
          user: { id: parseInt(rows[i][0]), line_user_id: rows[i][1], state_json: rows[i][3] || null },
        };
      }
    }

    // 沒找到，新增使用者
    console.log(`[DB] 新使用者，建立中: ${lineUserId}`);
    const newUserId = rows.length; // 用目前的行數當作簡單的 ID
    const newRow = [[newUserId, lineUserId, new Date().toISOString(), '']];
    const newRowNumber = rows.length + 1;

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'Users!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: newRow },
    });

    return {
      rowNumber: newRowNumber,
      user: { id: newUserId, line_user_id: lineUserId, state_json: null },
    };
  }
  
  /**
   * 更新特定使用者的狀態
   * @param rowNumber 使用者在 Users 分頁中的列號
   * @param state 要儲存的狀態物件
   */
  async setUserState(rowNumber: number, state: object | null): Promise<void> {
    const range = `Users!D${rowNumber}`; // 目標是 D 欄 (state_json)
    const value = state ? JSON.stringify(state) : ''; // 如果是 null 就清空儲存格

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: range,
      valueInputOption: 'RAW', // 使用 RAW 避免 JSON 被解析成公式
      requestBody: {
        values: [[value]],
      },
    });
  }

  /**
     * ✨ 新增：將分析後的知識筆記存入 Sheet
     * @param userId 我們資料庫中的使用者 ID
     * @param knowledgeData 從 AI 分析圖片後得到的完整 JSON 物件
     * @returns 成功存入後，該筆記的新 ID
     */
    async saveKnowledgeNote(userId: number, knowledgeData: any): Promise<number> {
        const range = 'KnowledgeNotes!A:F'; // 目標是 KnowledgeNotes 分頁
        
        // 取得目前的行數，用來當作簡單的 note_id
        const response = await this.sheets.spreadsheets.values.get({ spreadsheetId: this.spreadsheetId, range: 'KnowledgeNotes!A:A' });
        const noteId = response.data.values ? response.data.values.length : 1;
        
        const newRow = [
            noteId,                       // A: note_id
            userId,                       // B: user_id
            null,                         // C: objective_id (暫時留空)
            'image',                      // D: source_type
            knowledgeData.source || '',   // E: raw_content (用 source 標題代替)
            JSON.stringify(knowledgeData) // F: structured_data_json (儲存完整的 JSON)
        ];

        await this.sheets.spreadsheets.values.append({
            spreadsheetId: this.spreadsheetId,
            range: range,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [newRow] },
        });

        console.log(`[DB] 已成功儲存筆記，ID: ${noteId}`);
        return noteId;
    }
    async findObjectiveByTitle(userId: number, title: string): Promise<LearningObjective | null> {
        const range = 'LearningObjectives!A:F';
        const response = await this.sheets.spreadsheets.values.get({ spreadsheetId: this.spreadsheetId, range: range });
        const rows = response.data.values || [];

        for (let i = 1; i < rows.length; i++) {
            const rowUserId = parseInt(rows[i][1]);
            const rowTitle = rows[i][2];
            // 確保是同一個使用者的，並且標題完全匹配
            if (rowUserId === userId && rowTitle === title) {
                console.log(`[DB] 成功找到目標: ${title}`);
                return {
                    objective_id: parseInt(rows[i][0]),
                    user_id: rowUserId,
                    title: rowTitle,
                    status: rows[i][3],
                    due_date: rows[i][4] || null,
                    gcal_event_ids: rows[i][5] || null,
                };
            }
        }
        console.log(`[DB] 找不到目標: ${title}`);
        return null;
    }
    /**
     * ✨ 新增：根據 ID 從 Sheet 中讀取一筆知識筆記
     * @param noteId 筆記的 ID
     * @returns 包含筆記資料的物件，或在找不到時回傳 null
     */
    async getKnowledgeNoteById(noteId: number): Promise<any | null> {
        const range = 'KnowledgeNotes!A:F';
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId: this.spreadsheetId,
            range: range,
        });

        const rows = response.data.values || [];
        for (let i = 1; i < rows.length; i++) { // 從第二行開始找
            // 比較 A 欄的 note_id
            if (parseInt(rows[i][0]) === noteId) {
                console.log(`[DB] 成功讀取筆記，ID: ${noteId}`);
                // 回傳 F 欄的結構化 JSON，並解析它
                return JSON.parse(rows[i][5]); 
            }
        }
        
        console.error(`[DB] 找不到筆記，ID: ${noteId}`);
        return null; // 找不到
    }

    /**
     * ✨ 新增：獲取所有使用者
     */
    async getAllUsers(): Promise<User[]> {
        const range = 'Users!A:D';
        const response = await this.sheets.spreadsheets.values.get({ spreadsheetId: this.spreadsheetId, range: range });
        const rows = response.data.values || [];
        const users: User[] = [];

        // 從第二行開始，將每一行轉換為 User 物件
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][0] && rows[i][1]) { // 確保 user_id 和 line_user_id 存在
                users.push({
                    id: parseInt(rows[i][0]),
                    line_user_id: rows[i][1],
                    state_json: rows[i][3] || null,
                });
            }
        }
        return users;
    }

    /**
     * ✨ 新增：根據 user_id 獲取其所有進行中的學習目標
     */
    async getActiveObjectivesByUserId(userId: number): Promise<LearningObjective[]> {
        const range = 'LearningObjectives!A:F';
        const response = await this.sheets.spreadsheets.values.get({ spreadsheetId: this.spreadsheetId, range: range });
        const rows = response.data.values || [];
        const objectives: LearningObjective[] = [];

        for (let i = 1; i < rows.length; i++) {
            const rowUserId = parseInt(rows[i][1]);
            const status = rows[i][3];
            if (rowUserId === userId && status === 'In Progress') {
                objectives.push({
                    objective_id: parseInt(rows[i][0]),
                    user_id: rowUserId,
                    title: rows[i][2],
                    status: 'In Progress',
                    due_date: rows[i][4] || null,
                    gcal_event_ids: rows[i][5] || null,
                });
            }
        }
        return objectives;
    }

  /**
   * ✨ 新方法 4：將一則筆記關聯到一個學習目標
   * @param noteId 要更新的筆記 ID
   * @param objectiveId 要關聯到的目標 ID
   */
  async linkNoteToObjective(noteId: number, objectiveId: number): Promise<void> {
      const range = 'KnowledgeNotes!A:F';
      const response = await this.sheets.spreadsheets.values.get({ spreadsheetId: this.spreadsheetId, range: range });
      const rows = response.data.values || [];

      for (let i = 1; i < rows.length; i++) {
          // 找到 A 欄中對應的 noteId
          if (parseInt(rows[i][0]) === noteId) {
              const rowNumber = i + 1;
              // 目標是 C 欄 (objective_id)
              const updateRange = `KnowledgeNotes!C${rowNumber}`; 

              await this.sheets.spreadsheets.values.update({
                  spreadsheetId: this.spreadsheetId,
                  range: updateRange,
                  valueInputOption: 'RAW',
                  requestBody: { values: [[objectiveId]] }, // 寫入目標 ID
              });
              
              console.log(`[DB] 已成功將筆記 #${noteId} 歸檔到目標 #${objectiveId}`);
              return;
          }
      }
      console.error(`[DB] 歸檔失敗：找不到筆記 #${noteId}`);
  }
}