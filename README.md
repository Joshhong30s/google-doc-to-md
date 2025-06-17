# Google Docs to Markdown Converter

This project provides an automated workflow for converting Google Docs into Markdown format, complete with content refinement and image management — especially useful for preparing blog posts.

## Features

- **Google Docs Export**: Automatically fetch HTML content from a specified Google Doc ID.
- **HTML to Markdown Conversion**: Converts HTML to Markdown using Turndown (with GFM support).
- **HTML Preprocessing**: Cleans up common Google Docs `<span>` styling by converting them into standard `<strong>` (bold) and `<em>` (italic) tags.
- **Title & Category Extraction**:
  - First `<h1>` is used as the `title`.
  - Second `<h1>` is used as the `category`.
  - If no `<h1>` tags are found, a fallback mechanism extracts the first 30 characters of content as the title.
- **Image Upload & Replacement**:
  - Detects all images in the HTML.
  - Uploads them to Cloudinary (default folder: `"Education"`).
  - Replaces the original image links in the Markdown with secure Cloudinary CDN URLs.
- **AI Content Refinement**: Uses the OpenAI GPT-3.5 Turbo API to improve grammar, structure, and formatting in the converted Markdown.
- **Frontmatter Generation**: Automatically adds YAML frontmatter to the Markdown file:
  - `title`: Extracted or fallback value.
  - `date`: Conversion date (current date).
  - `tags`: Default is an empty array (can be edited later).
  - `category`: Extracted or fallback value.
  - `image`: The first uploaded Cloudinary image is used as the cover (if no image is found, a default is used).
- **File Management**:
  - Supports passing single or multiple Google Doc IDs via CLI arguments (comma-separated).
  - If no CLI args are passed, the script reads IDs from `unConvertDocIds.json`.
  - Successfully converted IDs are removed from `unConvertDocIds.json` and added to `convertedDocIds.json` for tracking.
- **Output Directory**: By default, Markdown files are saved to `D:/skyline-education-consultant/blogposts/zh` (you can change this in `convertAndReorg.js` by modifying the `outputDir` variable).

## Tech Stack

- **Primary Language**: Node.js (ES Modules)
- **HTML Processing**: `jsdom` (for DOM parsing), `turndown` (for conversion), `turndown-plugin-gfm` (GFM support)
- **Image Upload**: `cloudinary`
- **AI Integration**: OpenAI API (called using `node-fetch`)

## Setup

1. **Clone the Project**:

   ```bash
   git clone <your-repository-url>
   cd google-docs-to-md
   ```

2. **Install Dependencies**:

   ```bash
   npm install
   ```

3. **Set Up Environment Variables**:
   Create a `.env.local` file in the project root with the following keys:

   ```env
   # OpenAI API Key
   OPENAI_API_KEY=your_openai_api_key_here

   # Cloudinary Credentials
   CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
   CLOUDINARY_API_KEY=your_cloudinary_api_key
   CLOUDINARY_API_SECRET=your_cloudinary_api_secret
   ```

4. **Prepare Google Doc ID List (Optional)**:
   If you prefer not to use CLI arguments, create a `unConvertDocIds.json` file in the root directory with the following content:
   ```json
   ["your_google_doc_id_1", "your_google_doc_id_2"]
   ```
   The script will also manage `convertedDocIds.json` automatically.

## Usage

The main script is `convertAndReorg.js`.

1. **Convert Specific Google Doc(s)**:
   You can pass one or more Google Doc IDs as command-line arguments.

   ```bash
   # Convert a single document
   node convertAndReorg.js <your_google_doc_id>

   # Convert multiple documents (comma-separated, no spaces)
   node convertAndReorg.js <id1>,<id2>,<id3>
   ```

   In this mode, `unConvertDocIds.json` and `convertedDocIds.json` will NOT be updated.

2. **Batch Convert from `unConvertDocIds.json`**:
   If no CLI arguments are passed, the script will read from `unConvertDocIds.json`.
   ```bash
   node convertAndReorg.js
   ```
   Successfully converted IDs will be removed from `unConvertDocIds.json` and added to `convertedDocIds.json`.

## Script Overview

- **`convertAndReorg.js`**:

  - The core script that orchestrates the entire process: fetch HTML → preprocess → convert to Markdown → upload images → AI polish → save Markdown with frontmatter.
  - Manages unconverted and converted ID lists.

- **`cloudinaryUploader.js`**:

  - Responsible for uploading images to Cloudinary.
  - Called internally by `convertAndReorg.js`.

- **`google-docs-output.html`**:
  - Stores the raw HTML fetched from Google Docs each time the script is run — useful for debugging and review.

## Notes

- **Google Doc Permissions**: Make sure your Google Docs are shared publicly or set to "Anyone with the link can view". Otherwise, the script will not be able to fetch the document via the export link.
- **API Keys Security**: Never commit your API keys. `.env.local` is already in `.gitignore`.
- **Output Path**: Default is `D:/skyline-education-consultant/blogposts/zh`. You can customize this in `convertAndReorg.js` by changing the `outputDir`.
- **OpenAI Costs**: Note that using the OpenAI API will incur usage costs.
- **Error Handling**: The script includes basic error handling, but complex Google Docs or network issues might still cause failures. In batch mode, failed conversions will not be removed from `unConvertDocIds.json`.


## License

MIT
