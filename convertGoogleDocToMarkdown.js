import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import fs from "fs-extra";
import path from "path";
import { uploadImageToCloudinary } from "./cloudinaryUploader.js";
import { gfm, tables } from "turndown-plugin-gfm"; // 可同时引入 tables

// 初始化 HTML 轉 Markdown 服務
const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
});
turndownService.use(gfm); // 或者使用: turndownService.use(tables);
// turndownService.use(tables);

// 處理 Google Docs 特殊格式的 `<span>` 標籤
// function preprocessGoogleDocsHTML(document) {
//   document.querySelectorAll("span").forEach((span) => {
//     const style = span.style.cssText.toLowerCase();

//     // **處理粗體 (bold)**
//     if (
//       style.includes("font-weight: bold") ||
//       style.includes("font-weight: 700")
//     ) {
//       const strong = document.createElement("strong");
//       strong.innerHTML = span.innerHTML;
//       span.replaceWith(strong);
//     }

//     // **處理斜體 (italic)**
//     else if (style.includes("font-style: italic")) {
//       const em = document.createElement("em");
//       em.innerHTML = span.innerHTML;
//       span.replaceWith(em);
//     }
//   });
// }

// turndownService.addRule("bold", {
//   filter: ["strong", "b"],
//   replacement: (content) => `**${content}**`,
// });

// turndownService.addRule("italic", {
//   filter: ["em", "i"],
//   replacement: (content) => `*${content}*`,
// });

async function convertGoogleDocToMarkdown(docId, outputDir) {
  try {
    const googleDocsAPI = `https://docs.google.com/document/d/${docId}/export?format=html`;
    console.log(`Fetching Google Docs content from: ${googleDocsAPI}`);

    // 1️⃣ 取得 Google Docs 內容
    const res = await fetch(googleDocsAPI);
    if (!res.ok)
      throw new Error(`❌ 無法獲取 Google Docs，狀態碼: ${res.status}`);

    const html = await res.text();
    fs.writeFileSync("google-docs-output.html", html, "utf8");
    console.log("已儲存 HTML，請手動打開 google-docs-output.html 查看");

    if (html.length < 100)
      throw new Error("❌ 可能沒有正確獲取 Google Docs 內容");

    // 2️⃣ 解析 HTML
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // 轉換 Google Docs 內部 span 標籤
    preprocessGoogleDocsHTML(document);

    // (可选) 对表格进行预处理，移除内联样式和 class
    // const tablesEls = document.querySelectorAll("table");
    // tablesEls.forEach((table) => {
    //   table.removeAttribute("style");
    //   table.removeAttribute("class");
    // });

    // 3️⃣ 嘗試依序獲取 title 與 category（以 h1 順序為準）
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

    // 6️⃣ 生成安全的檔名（去掉非法字元）
    const safeFilename = title
      .replace(/[<>:"/\\|?*]+/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();

    // 7️⃣ 取得今天的日期
    const today = new Date().toISOString().split("T")[0];

    // 8️⃣ 轉換 HTML → Markdown
    let markdownContent = turndownService.turndown(document.body.innerHTML);
    console.log("Converted Markdown:", markdownContent); // 调试输出

    // 9️⃣ 確保 Markdown 內容不是空白
    if (!markdownContent || markdownContent.trim().length === 0) {
      throw new Error("❌ 轉換後的 Markdown 內容為空，可能是 HTML 結構有問題");
    }

    // 🔟 處理圖片並取得第一張圖片的上傳 URL
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

    // 11️⃣ 預設 Metadata
    const metadata = `---
title: '${title}'
date: '${today}'
tags: []
category: '${category}'
image: '${imageMetadata}'
---
`;

    // 12️⃣ 儲存 Markdown（含 Metadata）
    const finalMarkdown = metadata + "\n" + markdownContent;
    const filePath = path.join(outputDir, `${safeFilename}.md`);
    await fs.ensureDir(outputDir);
    await fs.writeFile(filePath, finalMarkdown, "utf8");

    console.log(`✅ 文章轉換完成，已儲存至 ${filePath}`);
  } catch (error) {
    console.error(`🚨 發生錯誤: ${error.message}`);
  }
}

const docId = process.argv[2];
const outputDir = "D:/skyline-education-consultant/blogpost/zh";

if (!docId) {
  console.error(
    "❌ 請提供 Google Docs ID，例如: node convertGoogleDocToMarkdown.js <GoogleDocsID>"
  );
  process.exit(1);
}

convertGoogleDocToMarkdown(docId, outputDir);
