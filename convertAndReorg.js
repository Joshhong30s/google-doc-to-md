import dotenv from "dotenv";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import fs from "fs-extra";
import path from "path";
import { uploadImageToCloudinary } from "./cloudinaryUploader.js";
import { gfm, tables } from "turndown-plugin-gfm";

dotenv.config({ path: "./.env.local" });

const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
});
turndownService.use(gfm);

function preprocessGoogleDocsHTML(document) {
  document.querySelectorAll("span").forEach((span) => {
    const style = span.style.cssText.toLowerCase();
    if (
      style.includes("font-weight: bold") ||
      style.includes("font-weight: 700")
    ) {
      const strong = document.createElement("strong");
      strong.innerHTML = span.innerHTML;
      span.replaceWith(strong);
    } else if (style.includes("font-style: italic")) {
      const em = document.createElement("em");
      em.innerHTML = span.innerHTML;
      span.replaceWith(em);
    }
  });
}

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

    const res = await fetch(googleDocsAPI);
    if (!res.ok)
      throw new Error(`❌ 無法獲取 Google Docs，狀態碼: ${res.status}`);

    const html = await res.text();
    fs.writeFileSync("google-docs-output.html", html, "utf8");
    console.log("已儲存 HTML，請手動打開 google-docs-output.html 查看");

    if (html.length < 100)
      throw new Error("❌ 可能沒有正確獲取 Google Docs 內容");

    const dom = new JSDOM(html);
    const document = dom.window.document;

    preprocessGoogleDocsHTML(document);

    const h1Elements = document.querySelectorAll("h1");
    let title = "";
    let category = "";

    if (h1Elements.length > 0) {
      title = h1Elements[0].textContent.trim();
      h1Elements[0].remove();
    }

    if (h1Elements.length > 1) {
      category = h1Elements[1].textContent.trim();
      h1Elements[1].remove();
    }

    if (!title || title.length < 5) {
      console.warn(
        "⚠️  找不到 `<h1>` 或 `<p>`，將擷取內文的前 30 個字元作為標題..."
      );
      const bodyText = document.body.textContent.trim().replace(/\s+/g, " ");
      title = bodyText.substring(0, 30);
    }

    if (!title || title.length === 0) {
      console.warn("⚠️  找不到適合的標題，使用預設名稱 '未命名文章'");
      title = "未命名文章";
    }

    if (!category) {
      category = "Uncategorized";
    }

    const safeFilename = title
      .replace(/[<>:"/\\|?*]+/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();

    const today = new Date().toISOString().split("T")[0];

    let markdownContent = turndownService.turndown(document.body.innerHTML);

    if (!markdownContent || markdownContent.trim().length === 0) {
      throw new Error("❌ 轉換後的 Markdown 內容為空，可能是 HTML 結構有問題");
    }

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

    const imageMetadata = firstImageUrl || "/default-thumbnail.jpg";

    markdownContent = await refineMarkdown(markdownContent);

    const metadata = `---
title: '${title}'
date: '${today}'
tags: []
category: '${category}'
image: '${imageMetadata}'
---

`;

    const finalMarkdown = metadata + "\n" + markdownContent;
    const filePath = path.join(outputDir, `${safeFilename}.md`);
    await fs.ensureDir(outputDir);
    await fs.writeFile(filePath, finalMarkdown, "utf8");

    console.log(`✅ 文章轉換完成，已儲存至 ${filePath}`);
    return true;
  } catch (error) {
    console.error(`🚨 發生錯誤: ${error.message}`);
    return false;
  }
}

const outputDir = process.env.OUTPUT_DIR;

const docIdsArg = process.argv[2];

if (docIdsArg) {
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
  const unConvertDocIdsPath = path.join(process.cwd(), "unConvertDocIds.json");
  const convertedDocIdsPath = path.join(process.cwd(), "convertedDocIds.json");

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
        docIds = docIds.filter((docId) => docId !== id);
        await fs.writeJson(unConvertDocIdsPath, docIds, { spaces: 2 });
        console.log(`已從 ${unConvertDocIdsPath} 刪除已轉換的 docId: ${id}`);

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
