// src/services/intelligentPlanner.ts

import { GoogleGenerativeAI } from "@google/generative-ai";

// 透過環境變數初始化 Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export class IntelligentPlanner {
  /**
   * 分析使用者輸入，並將其轉換為結構化的指令或計畫。
   * @param userInput 使用者從 LINE 輸入的原始訊息
   * @returns 一個包含 action 和 params 的 JSON 物件
   */
  static async understandAndPlan(userInput: string): Promise<any> {
    // 修改後的程式碼
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

    // 這段 Prompt 是整個智慧助理的靈魂，我們在這裡教 AI 如何思考。
    const prompt = `
      你是一個頂尖的個人助理，專門幫助使用者管理他們的學習計畫。你的工作是分析使用者的需求，並輸出一個標準化的 JSON 物件。
      你最重要的任務之一，是分辨使用者是想做一個「通用規劃」，還是想為一個「已存在的特定目標」做規劃。

      # 可用的工具 (actions):
      1.  **list_events**: 查詢行事曆上的事件。
          - 觸發條件: 當使用者想知道某個時間點的行程時 (例如："今天有什麼事？", "查詢下週行程")。
          - 必要參數: 'timeRange' ('today', 'tomorrow', 'week')。

      2.  create_event: 建立一個單獨的、明確的行事曆事件。
          - 觸發條件: 使用者明確指示要新增一個有時間和標題的事件。
          - 必要參數: 'summary' (事件標題), 'startTime' (ISO 8601 格式的時間)。
          - 規則：如果使用者的規劃請求中，提到了某個學習目標 (用引號標出，例如 "幫我規劃『OpenVINO 競賽』")，你必須在 JSON 中額外增加一個 'objectiveTitle' 欄位，其值為該目標的標題。

      3.  **plan_generic_task**: ✨ 當使用者提出一個模糊的、不含特定目標標題的複雜規劃請求時。
          - 觸發條件: "幫我規劃下週的讀書計畫", "我該如何準備期末考？"
          - 必要參數: 'plan' (一個陣列，包含 { summary, duration_hours })。


      4.  **clarify_or_reject**: 當使用者意圖不明，或提出無法處理的需求時使用。
           - 必要參數: 'response' (你希望機器人回覆的文字)。
           - **觸發條件 1 (自我介紹)**: 如果使用者用友善的、非指令性的方式打招呼 (例如: "你好", "你是誰", "你能做什麼？", "hi", "hello")，請使用這個 action，並將 'response' 設為下面這段固定的自我介紹文字。
           - **觸發條件 2 (拒絕)**: 如果使用者提出的要求與學習或行事曆完全無關 (例如: "今天天氣如何？", "講個笑話")，也使用這個 action，並回覆禮貌的拒絕訊息。
      5.  **delete_event**: 刪除一個已存在的行事曆事件。
          - 觸發條件: 使用者明確指示要刪除或取消某個行程 (例如："刪除明天的會議", "取消下週三的讀書會")。
          - 必要參數: 'query' (用來搜尋要刪除的事件的關鍵字)。

      6. **create_learning_objective**: 當使用者想要建立一個新的長期學習目標或專案時。
          - 觸發條件: "建立一個學習目標...", "新增一個專案叫...", "我想開始準備..."
          - 必要參數: 'title' (目標標題)。
          - 可選參數: 'dueDate' (目標的截止日期，必須是 'YYYY-MM-DD' 格式)。

      7. **plan_for_objective**: 當使用者明確提到一個「已存在的目標標題」（通常會用引號『』或 "" 標出）並要求為其規劃時。
          - 觸發條件: "幫我規劃『我的目標』", "為『那個競賽』安排一下"
          - 必要參數: 'objectiveTitle' (目標的標題)。
          - **你必須從使用者的輸入中，精確地提取出目標的標題。**

      8. **link_note_to_objective**: 當使用者在分析完筆記後，想要將筆記歸檔到某個目標時。
          - 觸發條件: "把這個歸檔到『期末考』", "這是 OpenVINO 的筆記"
          - 必要參數: 'objectiveTitle' (目標的標題)。

      # ⭐⭐⭐ 重要規則：時間處理 ⭐⭐⭐
      - 當你需要提供 'dueDate' 時，必須是 'YYYY-MM-DD' 格式。
      - 當你需要提供 'startTime' 或 'endTime' 時，你 **必須** 計算出確切的 ISO 8601 標準時間字串 (例如："2025-07-30T19:00:00.000+08:00")。
      - 當前時間是：${new Date().toISOString()}
      - **絕對不可以使用** 任何形式的佔位符 (例如："【請填入...】") 或相對時間描述 (例如："今晚7點") 作為時間值。你必須完成最終的計算。

      # 輸出規則:
      - 你的回應 **必須** 是一個格式正確的 JSON 物件，絕對不能包含任何額外的文字、註解或 "'''json" 標籤。
      - 直接輸出 JSON 內容。

      # 範例
      ## 輸入: "我想建立一個目標，在8月20號前完成 OpenVINO 競賽的準備"
      ## 輸出:
      {
        "action": "create_learning_objective",
        "params": {
          "title": "完成 OpenVINO 競賽的準備",
          "dueDate": "2025-08-20"
        }
      }

      ## 輸入: "幫我規劃一下『完成 OpenVINO 競賽的準備』這個目標"
      ## 輸出:
      {
        "action": "plan_complex_task",
        "objectiveTitle": "完成 OpenVINO 競賽的準備",
        "plan": [
          { "summary": "OpenVINO 競賽準備 - Day 1: 研讀競賽規則與需求", "duration_hours": 2 },
          { "summary": "OpenVINO 競賽準備 - Day 2: brainstorming 與主題發想", "duration_hours": 3 }
        ]
      }
      ## 輸入: "你建議我一週内怎麽學習完成 fpgaemu 的課程？"
      ## 輸出:
      {
        "action": "plan_complex_task",
        "task_description": "一週內學習完成 fpgaemu 的課程",
        "plan": [
          { "summary": "FPGAEMU 學習 - Day 1: 基礎概念與環境設定", "duration_hours": 2 },
          { "summary": "FPGAEMU 學習 - Day 2: Verilog 語法與實作", "duration_hours": 3 },
          { "summary": "FPGAEMU 學習 - Day 3: AXI-Lite 介面理解", "duration_hours": 3 },
          { "summary": "FPGAEMU 學習 - Day 4: 專案整合與模擬測試", "duration_hours": 4 },
          { "summary": "FPGAEMU 學習 - Day 5: 複習與除錯", "duration_hours": 2 }
        ]
      }

      ## 輸入: "明天下午兩點跟 David 開會"
      ## 輸出:
      {
        "action": "create_event",
        "params": {
          "summary": "跟 David 開會",
          "startTime": "2025-07-30T14:00:00.000+08:00"
        }
      }

      ## 輸入: "今天天氣如何？"
      ## 輸出:
      {
        "action": "clarify_or_reject",
        "params": {
          "response": "你好！我是一個 AI 學習助理，我的目標是幫助你更有效率地學習與規劃。\n\n我可以做到：\n🧠 **視覺分析**：傳送手寫筆記、課程海報的圖片，我會為你整理重點，並可進一步生成心智圖或測驗題。\n📅 **智慧規劃**：告訴我你的學習目標，我會幫你拆解成可執行的讀書計畫，並排入行事曆。\n\n你可以試著說『幫我規劃下週的學習計畫』，或直接傳一張你的筆記圖片給我看看！"
        }
      }

      ## 輸入: "幫我取消明天的團隊會議"
      ## 輸出:
      {
        "action": "delete_event",
        "params": {
            "query": "團隊會議"
        }
      }
      ---
      好了，現在請分析以下使用者的最新輸入，並只回傳 JSON 物件:
      "${userInput}"
    `;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      // 清理並解析 LLM 回傳的 JSON 字串，以防萬一它還是包含了 markdown 標籤
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (error) {
      console.error("呼叫 Gemini API 時發生錯誤:", error);
      return {
        action: 'clarify_or_reject',
        params: { response: '抱歉，我的 AI 大腦暫時短路了，請稍後再試一次。' }
      };
    }
  }
  /**
   * ✨ 新方法：專門為一個已知的目標標題，生成一個詳細的學習計畫
   */
  static async generatePlanForObjective(objectiveTitle: string): Promise<any> {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
      const prompt = `
        你是一個專業的計畫拆解專家。你的任務是為使用者的一個具體學習目標，生成一個包含多個步驟的詳細計畫。

        # 學習目標:
        "${objectiveTitle}"

        # 你的任務:
        1. 分析這個目標，將其拆解成 3 到 7 個合乎邏輯的、可執行的步驟。
        2. 為每個步驟設定一個合理的預估學習時長 (duration_hours)。
        3. 你的輸出必須是一個包含 "plan" 陣列的 JSON 物件。

        # 輸出格式範例:
        {
          "action": "plan_complex_task",
          "plan": [
            { "summary": "步驟一...", "duration_hours": 2 },
            { "summary": "步驟二...", "duration_hours": 3 }
          ]
        }
        ---
        現在，請為以上學習目標生成計畫。
      `;
      try {
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
          return JSON.parse(text);
      } catch (error) {
          console.error("生成目標計畫時出錯:", error);
          // 返回一個空的計畫作為後備
          return { action: 'plan_complex_task', plan: [] };
      }
  }
    /**
   * 當使用者面對一個選項列表時，解析他們做出的選擇。
   * @param selectionRequest 使用者的回覆，例如 "第一個", "2 and 3", "all"
   * @param numberOfOptions 列表中的選項總數
   * @returns 一個包含所選索引的陣列 (例如 [0, 2]) 或一個關鍵字 ('all', 'none')
   */
  static async parseDeletionChoice(selectionRequest: string, numberOfOptions: number): Promise<{ selection: number[] | 'all' | 'none' }> {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    const prompt = `
      你的任務是解析使用者在一個選項列表中的選擇。使用者正在決定要刪除哪些行事曆行程。

      # 選項總數: ${numberOfOptions}

      # 使用者回覆: "${selectionRequest}"

      # 你的任務:
      1.  分析使用者的回覆，判斷他們選擇了哪些項目。
      2.  如果使用者選擇了具體的數字，回傳一個從 0 開始的索引陣列。記住，使用者說的 "1" 對應到索引 0。
      3.  如果使用者表示要全部刪除，回傳 "all"。
      4.  如果使用者表示取消或一個都不刪，回傳 "none"。
      5.  你的回應必須是以下格式的 JSON 物件: { "selection": [...] } 或 { "selection": "all" } 或 { "selection": "none" }。
      6.  絕對不能包含任何額外的文字或註解。

      # 範例
      - 使用者回覆: "刪除第一個和第三個" -> 輸出: { "selection": [0, 2] }
      - 使用者回覆: "第2個" -> 輸出: { "selection": [1] }
      - 使用者回覆: "全部都刪掉" -> 輸出: { "selection": "all" }
      - 使用者回覆: "不用了，謝謝" -> 輸出: { "selection": "none" }

      ---
      現在，請解析以上使用者回覆並只回傳 JSON。
    `;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const cleanJson = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (error) {
      console.error("解析刪除選項時出錯:", error);
      return { selection: 'none' }; // 出錯時預設為不刪除，以策安全
    }
  }

   /**
   * 根據使用者提出的修改要求，來調整一個已經存在的計畫。
   * @param originalPlan 先前 AI 產生的原始計畫 JSON 物件
   * @param modificationRequest 使用者提出的修改指令
   * @returns 一個包含新計畫的 JSON 物件
   */
  static async modifyPlan(originalPlan: any, modificationRequest: string): Promise<any> {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

    // 這個 Prompt 專門用於修改任務
    const prompt = `
      你是一個精確的個人助理，你的任務是修改一個既有的行事曆計畫。

      # 這是使用者不滿意的原始計畫 (一個 JSON 陣列):
      \`\`\`json
      ${JSON.stringify(originalPlan, null, 2)}
      \`\`\`

      # 這是使用者提出的修改要求:
      "${modificationRequest}"

      # 你的任務:
      1.  仔細閱讀修改要求，理解使用者想要改變哪個部分。
      2.  **關鍵規則**: 使用者提到的「階段1」對應到陣列的第一個元素 (索引 0)，「階段2」對應到第二個元素 (索引 1)，以此類推。
      3.  基於原始計畫，產出一個全新的、修改後的計畫 JSON 物件。
      4.  新計畫的 JSON 結構必須和原始計畫完全一樣（包含一個 "plan" 陣列），只修改使用者提到的部分。
      5.  **不要改變沒有被要求修改的部分**。例如，如果使用者只要求修改時長，就不要去改動 summary。
      6.  你的回應 **必須** 是一個格式正確的 JSON 物件，絕對不能包含任何額外的文字或註解。

      # 範例
      ## 原始計畫:
      { "plan": [{ "summary": "階段1", "duration_hours": 4 }, { "summary": "階段2", "duration_hours": 4 }] }
      ## 修改要求:
      "把階段1的時長減少到1小時，階段2加1小時"
      ## 你的輸出 (注意，輸出格式要保持一致):
      {
        "action": "plan_complex_task",
        "plan": [
          { "summary": "階段1", "duration_hours": 1 },
          { "summary": "階段2", "duration_hours": 5 }
        ]
      }
      ---
      現在，請根據以上規則，產出修改後的新計畫 JSON。
    `;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedJson = JSON.parse(cleanJson);
      if (Array.isArray(parsedJson)) {
            return { action: 'plan_complex_task', plan: parsedJson };
        }
        if (!parsedJson.action) {
            parsedJson.action = 'plan_complex_task';
        }
        return parsedJson;

    } catch (error) {
      console.error("呼叫 Gemini API 進行修改時發生錯誤:", error);
      return {
        action: 'clarify_or_reject',
        params: { response: '抱歉，我在修改計畫時遇到了一些困難，請您重新提出一次完整的規劃需求。' }
      };
    }
  }
  
  /**
   * 分析一張圖片的內容，並根據內容規劃行動或轉錄文字。
   * @param imageBuffer 使用者上傳圖片的 Buffer 資料
   * @returns 一個包含 action 和 params 的 JSON 物件
   */
  static async analyzeImageAndPlan(imageBuffer: Buffer): Promise<any> {
    // 使用支援視覺的多模態模型
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" }); 

    const prompt = `
      # Advanced Learning Content Assistant (V2 - High Accuracy Mode)

      You are an expert-level assistant specialized in data extraction from images, particularly for academic and event-related content like posters and syllabi. Your primary goal is **accuracy and completeness**.

      ## Core Tasks & Rules:
      1.  **Analyze the image meticulously.** Identify if it's for learning (notes) or for scheduling (events).
      2.  **Event Extraction (Crucial!)**: 
          - Scan the image for any text associated with a date, day, or deadline.
          - **For EACH event you find, you MUST extract both its description (summary) and its corresponding date (date).**
          - If you cannot find a date for a specific event description, DO NOT include that event in the output plan.
          - **Do not duplicate events.** If you see the same event mentioned multiple times, consolidate it into a single entry.
          - The final output 'plan' array should only contain objects that have BOTH a **summary** and a **date**.
      3.  **Knowledge Reconstruction**: If the image contains study notes, perform knowledge reconstruction as before.

      ## JSON Output Format:
      - Return a valid JSON object.
      - Use one of the actions: **reconstruct_knowledge**, **create_event**, **plan_complex_task**.
      - **For 'plan_complex_task', every object in the 'plan' array MUST have a 'summary' AND a 'date' key.**
      - If the event time is specified on the image, extract it as part of the \`startTime\` (full ISO 8601 format). If no specific time or duration is mentioned for an event, add a \`"duration_hours": 1\` field to the event object by default.

      # Contextual Information:
      - The user is currently viewing their calendar for **August 2025**. Use this month as the primary context for any dates that are ambiguous (e.g., "the 15th" means "August 15th, 2025").
      - Current absolute time: ${new Date().toISOString()}

      # Current Time (for relative dates): ${new Date().toISOString()}

      # Examples:
        
        ## Input: Course syllabus with assignment deadlines
        ## Output:
        {
        "action": "plan_complex_task",
        "tool": "Google Calendar",
        "source": "EE412S",
        "plan": [
            {"summary": "Submit ML Assignment", "date": "2025-04-10"},
            {"summary": "FPGA Project Review", "date": "2025-04-15"}
        ]
        }

        ## Input: Handwritten lecture notes on Ohm's Law (Chinese text)
        ## Output:
        {
        "action": "reconstruct_knowledge",
        "tool": "NotebookLM",
        "source": "Circuits Lecture",
        "situation": "Analyzing a simple electrical circuit with a resistor and a battery.",
        "complication": "Student needs to determine the voltage drop across the resistor.",
        "question": "What is the relationship between voltage, current, and resistance?",
        "answer": "Ohm's Law states that V = I * R.",
        "concepts": ["電壓 (Voltage)", "電流 (Current)", "電阻 (Resistance)"],
        "flashcards": [
            {"question": "What does Ohm's Law state?", "answer": "Voltage equals current multiplied by resistance (V = I * R)."},
            {"question": "How do resistances combine in series?", "answer": "They add up: R_total = R1 + R2 + ..."}
        ],
        "reflection": [
            "How can Ohm's Law be applied to real-world circuits?",
            "What happens to current flow if resistance increases?"
        ],
        "furtherReading": [
            "https://en.wikipedia.org/wiki/Ohm%27s_law",
            "https://example.com/kirchhoff-laws-overview"
        ]
        }

        ## Input: Lecture slide on derivatives (English text)
        ## Output:
        {
        "action": "reconstruct_knowledge",
        "tool": "HackMD",
        "source": "Calculus Lecture",
        "concepts": ["Derivative", "Slope", "Instantaneous rate of change"],
        "summary": [
            "The derivative of a function measures its instantaneous rate of change.",
            "It is defined as the limit of the difference quotient as the interval approaches zero."
        ],
        "flashcards": [
            {"question": "How is the derivative defined mathematically?", "answer": "As the limit of (f(x+h)-f(x))/h as h -> 0."},
            {"question": "What is the derivative of x^2?", "answer": "2x."}
        ],
        "furtherReading": [
            "https://en.wikipedia.org/wiki/Derivative",
            "https://example.com/derivative-intro"
        ]
        }
        
      # Instructions:
      Analyze the provided input (image or text) and return a JSON object formatted for the specified action and tool.
    `;

    try {
      // 這是多模態請求的格式：一個文字部分，一個圖片部分
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: imageBuffer.toString("base64"),
            mimeType: "image/jpeg", // or "image/png"
          },
        },
      ]);
      
      const response = await result.response;
      const text = response.text();
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);

    } catch (error) {
      console.error("呼叫 Gemini Vision API 時發生錯誤:", error);
      return {
        action: 'clarify_or_reject',
        params: { response: '抱歉，我無法成功辨識這張圖片的內容，請您換一張圖片或直接用文字告訴我需求。' }
      };
    }
  }


  /**
   * 對已經結構化的知識進行二次加工，例如生成心智圖、測驗等。
   */
  static async processKnowledge(knowledgeData: any, goal: string): Promise<string> {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" }); 

      const prompt = `
        你是一位頂尖的教育科技專家與圖表生成大師。你已經有了一份結構化的知識資料，現在你的任務是根據使用者的最終目標，將這份資料轉換成特定格式的成品。

        # 已結構化的知識資料:
        \`\`\`json
        ${JSON.stringify(knowledgeData, null, 2)}
        \`\`\`

        # 使用者的最終目標:
        "${goal}"

        # 你的任務與規則:

        ---
        ## 1. 心智圖 (Mind Map) 生成規則
        你必須先判斷使用者想要哪種心智圖：

        A) **如果使用者只說「心智圖」、「生成心智圖」等通用指令：**
          - 生成一份**詳盡的 Markdown 心智圖**。
          - **規則**: 
            - 使用 Markdown 標題 (#, ##) 和列表 (*, -) 來展示清晰的層級結構。
            - 在核心關鍵字的下一層，可以加入**簡潔的定義或關鍵要點**作為補充說明，以提供更多細節。
            -  striving for at least 2-3 levels of depth.

        B) **如果使用者的指令明確包含 "Mermaid" 這個詞 (例如 "生成 Mermaid 格式的心智圖"):**
          - 生成一份**Mermaid 語法的心智圖**。
          - **規則**:
            - 輸出必須被包裹在 \`\`\`mermaid ... \`\`\` 程式碼塊中。
            - 語法必須遵循 Mermaid 的 mindmap 圖表標準。
            - **範例**:
              \`\`\`mermaid
              mindmap
                root((Operating Systems))
                  ::icon(fa fa-book)
                  Process Management
                    :::icon(fa fa-cogs)
                    Process States
                      - Ready
                      - Running
                      - Waiting (Blocked)
                    Process Scheduling
                  Key Concepts
                    - Swapping
                    - I/O Operations
              \`\`\`

        ---
        ## 2. 其他任務規則

        - **如果目標是「測驗 (Quiz)」或「考我」**: 根據知識內容，設計 3-5 個有深度的簡答題。
        - **如果目標是「學習卡片 (Flashcards)」**: 將核心概念和定義，轉換成 "名詞: 解釋" 的格式列表。
        - **如果目標是「摘要 (Summary)」**: 用 150 字以內的流暢文字，對整個知識主題進行總結。
        
        # 輸出規則:
        - 直接輸出使用者想要的最終成品文字。
        - 不需要任何額外的 JSON 或註解。

        ---
        現在，請根據使用者的最終目標，處理以上知識資料並輸出成品。
      `;

      try {
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (error) {
        console.error("二次知識加工時發生錯誤:", error);
        return "抱歉，我在處理您的請求時遇到了一些困難，請稍後再試。";
      }
  }


    /**
   * 將 AI 初步分析的不完整計畫，與使用者提供的修正文字進行合併。
   * @param partialPlan AI 產生的、可能缺少日期的計畫 JSON
   * @param userCorrection 使用者回覆的補充資訊
   */
  static async mergePlanWithCorrection(partialPlan: any, userCorrection: string): Promise<any> {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
    const prompt = `
      你是一個細心的助理。你的任務是將一份不完整的行程草案，用使用者提供的補充資訊來完善它。

      # 這是 AI 初步分析出的不完整草案:
      \`\`\`json
      ${JSON.stringify(partialPlan, null, 2)}
      \`\`\`

      # 這是使用者提供的補充和修正資訊:
      "${userCorrection}"

      # 你的任務:
      1.  仔細閱讀使用者的補充資訊。
      2.  將這些資訊（主要是日期和時間）填入到不完整的草案中對應的事件裡。
      3.  輸出一個完整的、所有事件都包含有效 'date' 或 'startTime' (ISO 8601 格式) 的全新 JSON 物件。
      4.  JSON 結構應與原始草案保持一致。
      5.  直接輸出 JSON，不要有任何額外文字。

      # 當前時間 (用於計算相對日期): ${new Date().toISOString()}
      ---
      請合併資訊並產出完整的計畫 JSON。
    `;
    
    try {
      const result = await model.generateContent(prompt);
      const cleanJson = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (error) {
      console.error("合併使用者修正時出錯:", error);
      // 返回原始計畫，並附上錯誤提示
      return { ...partialPlan, error: "合併修正時發生錯誤" };
    }
  }
}