# BJ Order Extractor

A Next.js web application designed to automatically extract Design Numbers (e.g., TRTP016, TRBL011) from Order/Quotation PDFs, export the extracted data directly to Google Sheets, and automatically gather local design files into an organized desktop folder.

## Key Features & Tech Stack

This project uses the following major libraries and tools:
- **Next.js 15+ & React 19:** Core web framework and UI library.
- **Tailwind CSS & Shadcn UI:** For styling and accessible, beautiful UI components.
- **Lucide React:** For clean, scalable icons.
- **PDF.js (`pdfjs-dist`):** Used on the frontend to parse and extract text from uploaded PDF files.
- **Google Sheets API (`googleapis` & `@react-oauth/google`):** For authenticating users and creating/updating Google Spreadsheets.
- **Node.js File System (`fs/promises`):** For local directory searching and file gathering.

---

## Setup Instructions for Office PC

Follow these steps to set up the project on a new local computer (like the office PC).

### 1. Prerequisites
- **Node.js:** Ensure Node.js (version 20 or higher recommended) is installed on the computer. You can download it from [nodejs.org](https://nodejs.org/).
- **Git:** Ensure Git is installed to pull the code.

### 2. Installation
Open your terminal (or Command Prompt/PowerShell) in the project folder and run:

```bash
npm install
```

This command automatically downloads and installs **all required libraries and dependencies** defined in the project's `package.json`, including packages such as:

- Next.js & React
- Tailwind CSS
- Shadcn UI dependencies
- Lucide React
- pdfjs-dist
- googleapis
- @react-oauth/google
- Any other required npm packages used by the project

> **Note:** You do **not** need to install these libraries individually. As long as the `package.json` and `package-lock.json` files are present, `npm install` will install the correct versions of every dependency automatically.


### 3. Environment Configuration
Create a file named `.env.local` in the root folder of the project. Add the following required environment variables:

```env
# Google OAuth Credentials (for Google Sheets Export)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Search Directories for the "Gather Files" Feature
# Separate multiple paths with a semicolon (;) or comma (,)
SEARCH_DIRECTORIES="E:\Catalogs;F:\Designs;C:\Users\Office\Desktop\Designs"
```
*Note: Make sure your `SEARCH_DIRECTORIES` accurately reflect the drives and folders on the office PC.*

### 4. Running the Application
To start the application locally, run:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. 

---

## Workflow Guide

1. **Upload:** Click to upload your Quotation PDF.
2. **Extract:** The app will automatically scan the text and list all recognized design numbers and quantities.
3. **Gather Files:** Click the "Gather Files" button. The app will search the folders defined in `SEARCH_DIRECTORIES`, create a new `Order_[Date]` folder on your Desktop, copy the found design folders/files there, and generate a missing items report.
4. **Export:** Click "Export to Google Sheets" to authenticate with your Google account and automatically generate a formatted spreadsheet of the order.
