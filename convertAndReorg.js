import dotenv from "dotenv";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import fs from "fs-extra";
import path from "path";
import { uploadImageToCloudinary } from "./cloudinaryUploader.js";
import { gfm, tables } from "turndown-plugin-gfm";

// read .env.local file
dotenv.config({ path: "./.env.local" });

console.log("process.env.OPENAI_API_KEY:", process.env.OPENAI_API_KEY);
// 初始化 HTML 轉 Markdown 服務
const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
});
turndownService.use(gfm);

// 假設這裡有你已經定義好的 preprocessGoogleDocsHTML
function preprocessGoogleDocsHTML(document) {
  document.querySelectorAll("span").forEach((span) => {
    const style = span.style.cssText.toLowerCase();
    // 處理粗體 (bold)
    if (
      style.includes("font-weight: bold") ||
      style.includes("font-weight: 700")
    ) {
      const strong = document.createElement("strong");
      strong.innerHTML = span.innerHTML;
      span.replaceWith(strong);
    }
    // 處理斜體 (italic)
    else if (style.includes("font-style: italic")) {
      const em = document.createElement("em");
      em.innerHTML = span.innerHTML;
      span.replaceWith(em);
    }
  });
}

// 使用 GPT-4 API 潤飾 Markdown 內容
async function refineMarkdown(markdownContent) {
  const prompt = `你認為這篇md的格式是否整齊完整, 請檢視任何可能有錯誤的地方進行優化, 如果表格不容易整齊呈現, 你也可以考慮用資訊清晰美觀的方式去呈現表格內的資訊。除了格式調整之外，請注意你的輸出不要增加文章沒有的文字，我僅要你調整後的結果。

原始內容：
${markdownContent}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content:
              "你是一位專業的內容編輯，請協助潤飾 Markdown 文章。請查看這篇md的格式是否整齊完整, 請檢視任何可能有錯誤的地方進行優化, 如果表格不容易整齊呈現, 你也可以考慮用資訊清晰美觀的方式去呈現表格內的資訊。除了格式調整之外，請注意你的輸出不要增加文章沒有的文字，我僅要你調整後的結果。",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API 錯誤，狀態碼: ${response.status}`);
    }
    const data = await response.json();
    const refined = data.choices[0].message.content;
    console.log("潤飾後的 Markdown:", refined);
    return refined;
  } catch (error) {
    console.error("呼叫 GPT-4 API 潤飾失敗:", error.message);
    console.error(error);
    return markdownContent;
  }
}

async function convertAndReorg(docId, outputDir) {
  try {
    const googleDocsAPI = `https://docs.google.com/document/d/${docId}/export?format=html`;
    console.log(`Fetching Google Docs content from: ${googleDocsAPI}`);

    // 取得 Google Docs 內容
    const res = await fetch(googleDocsAPI);
    if (!res.ok)
      throw new Error(`❌ 無法獲取 Google Docs，狀態碼: ${res.status}`);

    const html = await res.text();
    fs.writeFileSync("google-docs-output.html", html, "utf8");
    console.log("已儲存 HTML，請手動打開 google-docs-output.html 查看");

    if (html.length < 100)
      throw new Error("❌ 可能沒有正確獲取 Google Docs 內容");

    // 解析 HTML
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // 轉換 Google Docs 內部的 span 標籤
    preprocessGoogleDocsHTML(document);

    // 嘗試依序獲取 title 與 category（以 h1 順序為準）
    const h1Elements = document.querySelectorAll("h1");
    let title = "";
    let category = "";

    if (h1Elements.length > 0) {
      title = h1Elements[0].textContent.trim();
      // 移除第一個 h1 以免重複顯示
      h1Elements[0].remove();
    }

    if (h1Elements.length > 1) {
      category = h1Elements[1].textContent.trim();
      // 移除第二個 h1
      h1Elements[1].remove();
    }

    // 如果找不到 title 或 title 太短，則用內文前 30 個字
    if (!title || title.length < 5) {
      console.warn(
        "⚠️  找不到 `<h1>` 或 `<p>`，將擷取內文的前 30 個字元作為標題..."
      );
      const bodyText = document.body.textContent.trim().replace(/\s+/g, " ");
      title = bodyText.substring(0, 30);
    }

    // 如果 title 仍然為空，則使用預設值
    if (!title || title.length === 0) {
      console.warn("⚠️  找不到適合的標題，使用預設名稱 '未命名文章'");
      title = "未命名文章";
    }

    // 如果 category 為空，則給個預設值（例如 'Uncategorized'）
    if (!category) {
      category = "Uncategorized";
    }

    // 生成安全的檔名（去掉非法字元）
    const safeFilename = title
      .replace(/[<>:"/\\|?*]+/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();

    // 取得今天的日期
    const today = new Date().toISOString().split("T")[0];

    // 轉換 HTML → Markdown
    let markdownContent = turndownService.turndown(document.body.innerHTML);

    // 確保 Markdown 內容不是空白
    if (!markdownContent || markdownContent.trim().length === 0) {
      throw new Error("❌ 轉換後的 Markdown 內容為空，可能是 HTML 結構有問題");
    }

    // 處理圖片並取得第一張圖片的上傳 URL
    let firstImageUrl = "";
    const imgElements = document.querySelectorAll("img");
    for (const img of imgElements) {
      try {
        const imageUrl = img.src;
        console.log(`🖼️ 發現圖片: ${imageUrl}`);
        const uploadedImageUrl = await uploadImageToCloudinary(imageUrl);
        if (!firstImageUrl) {
          firstImageUrl = uploadedImageUrl;
        }
        markdownContent = markdownContent.replace(imageUrl, uploadedImageUrl);
        console.log(`✅ 圖片已上傳到 Cloudinary: ${uploadedImageUrl}`);
      } catch (imgError) {
        console.error(`❌ 圖片上傳失敗: ${imgError.message}`);
      }
    }

    // 使用第一張圖片作為 metadata 的 image，若無圖片則使用預設值
    const imageMetadata = firstImageUrl || "/default-thumbnail.jpg";

    // 呼叫 GPT-4 API 潤飾 Markdown 內容
    markdownContent = await refineMarkdown(markdownContent);

    // 預設 Metadata
    const metadata = `---
title: '${title}'
date: '${today}'
tags: []
category: '${category}'
image: '${imageMetadata}'
---

`;

    // 儲存 Markdown（含 Metadata）
    const finalMarkdown = metadata + "\n" + markdownContent;
    const filePath = path.join(outputDir, `${safeFilename}.md`);
    await fs.ensureDir(outputDir);
    await fs.writeFile(filePath, finalMarkdown, "utf8");

    console.log(`✅ 文章轉換完成，已儲存至 ${filePath}`);
    return true; // 轉換成功
  } catch (error) {
    console.error(`🚨 發生錯誤: ${error.message}`);
    return false; // 轉換失敗
  }
}

const outputDir = "D:/skyline-education-consultant/blogposts/zh";

// 檢查命令列參數
const docIdsArg = process.argv[2];

if (docIdsArg) {
  // 如果有傳入參數，則支援單篇或多篇（以逗號分隔），不更新 JSON
  const docIds = docIdsArg.includes(",")
    ? docIdsArg.split(",").map((id) => id.trim())
    : [docIdsArg];

  async function convertSelectedDocs() {
    for (const id of docIds) {
      console.log(`\n=== 正在轉換 docId: ${id} ===`);
      await convertAndReorg(id, outputDir);
    }
  }
  convertSelectedDocs();
} else {
  // 沒有傳入參數，則從指定的 JSON 檔案中讀取 docid
  const unConvertDocIdsPath = "D:/google-docs-to-md/unConvertDocIds.json";
  const convertedDocIdsPath = "D:/google-docs-to-md/convertedDocIds.json";

  if (!fs.existsSync(unConvertDocIdsPath)) {
    console.error(
      `❌ 檔案 ${unConvertDocIdsPath} 不存在，請先建立一個包含 docid 陣列的 JSON 檔案`
    );
    process.exit(1);
  }
  let docIds = await fs.readJson(unConvertDocIdsPath);
  if (!Array.isArray(docIds) || docIds.length === 0) {
    console.error("❌ JSON 檔案中沒有任何 docid");
    process.exit(1);
  }
  // 如果 convertedDocIds.json 不存在，先建立空陣列
  let convertedDocIds = [];
  if (fs.existsSync(convertedDocIdsPath)) {
    convertedDocIds = await fs.readJson(convertedDocIdsPath);
    if (!Array.isArray(convertedDocIds)) {
      convertedDocIds = [];
    }
  }

  async function convertAllDocs() {
    for (const id of [...docIds]) {
      console.log(`\n=== 正在轉換 docId: ${id} ===`);
      const success = await convertAndReorg(id, outputDir);
      if (success) {
        // 移除已轉換的 id
        docIds = docIds.filter((docId) => docId !== id);
        // 更新未轉換的 JSON 檔案
        await fs.writeJson(unConvertDocIdsPath, docIds, { spaces: 2 });
        console.log(`已從 ${unConvertDocIdsPath} 刪除已轉換的 docId: ${id}`);

        // 將轉換成功的 id 加入轉換紀錄檔
        convertedDocIds.push(id);
        await fs.writeJson(convertedDocIdsPath, convertedDocIds, { spaces: 2 });
        console.log(`已將 docId: ${id} 新增至 ${convertedDocIdsPath}`);
      } else {
        console.error(`docId ${id} 轉換失敗，暫不刪除`);
      }
    }
  }
  convertAllDocs();
}
