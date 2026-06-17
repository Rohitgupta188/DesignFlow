import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Helper function to recursively search directories
async function searchFiles(dir: string, designNos: string[]): Promise<{ itemPath: string, matchedDesign: string, isDirectory: boolean }[]> {
  const results: { itemPath: string, matchedDesign: string, isDirectory: boolean }[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      let matched = false;
      // Check if filename or foldername contains any design number
      for (const designNo of designNos) {
        if (entry.name.includes(designNo)) {
          results.push({ itemPath: fullPath, matchedDesign: designNo, isDirectory: entry.isDirectory() });
          matched = true;
          break;
        }
      }
      
      if (entry.isDirectory()) {
        // Skip hidden directories and common large ones to speed up search
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        
        // If the directory matched, we copy the whole directory, so no need to search inside it
        if (!matched) {
          const subResults = await searchFiles(fullPath, designNos);
          results.push(...subResults);
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
  }
  
  return results;
}

export async function POST(req: Request) {
  try {
    const { designNos } = await req.json();
    
    if (!designNos || !Array.isArray(designNos) || designNos.length === 0) {
      return NextResponse.json({ error: "Invalid or empty design numbers array" }, { status: 400 });
    }

    // 1. Determine Search Directories
    const searchDirsRaw = process.env.SEARCH_DIRECTORIES || "";
    // Handle both comma and semicolon separated paths, and trim quotes
    const searchDirs = searchDirsRaw
      .replace(/^["']|["']$/g, "") // remove surrounding quotes if any
      .split(";")
      .flatMap(d => d.split(",")) 
      .map(d => d.trim())
      .filter(d => d.length > 0);

    if (searchDirs.length === 0) {
      return NextResponse.json({ error: "No SEARCH_DIRECTORIES configured in environment" }, { status: 500 });
    }

    // 2. Prepare Output Directory on Desktop
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const orderFolderName = `Order_${timestamp}`;
    const desktopPath = path.join(os.homedir(), "Desktop");
    const outputFolderPath = path.join(desktopPath, orderFolderName);
    
    const foundFolderPath = path.join(outputFolderPath, "Found");
    const notFoundFolderPath = path.join(outputFolderPath, "Not_Found");

    await fs.mkdir(outputFolderPath, { recursive: true });
    await fs.mkdir(foundFolderPath, { recursive: true });
    await fs.mkdir(notFoundFolderPath, { recursive: true });

    // 3. Search for files
    const allFoundFiles: { itemPath: string, matchedDesign: string, isDirectory: boolean }[] = [];
    for (const searchDir of searchDirs) {
      try {
        const stats = await fs.stat(searchDir);
        if (stats.isDirectory()) {
          const found = await searchFiles(searchDir, designNos);
          allFoundFiles.push(...found);
        }
      } catch (e) {
        console.error(`Search directory invalid or inaccessible: ${searchDir}`, e);
      }
    }

    // 4. Copy files and determine missing
    const foundDesignNos = new Set<string>();
    let copiedCount = 0;

    for (const { itemPath, matchedDesign, isDirectory } of allFoundFiles) {
      const itemName = path.basename(itemPath);
      const destPath = path.join(foundFolderPath, itemName);
      try {
        if (isDirectory) {
          await fs.cp(itemPath, destPath, { recursive: true });
        } else {
          await fs.copyFile(itemPath, destPath);
        }
        foundDesignNos.add(matchedDesign);
        copiedCount++;
      } catch (err) {
        console.error(`Failed to copy ${itemPath} to ${destPath}:`, err);
      }
    }

    // 5. Generate Missing Designs Report
    const missingDesignNos = designNos.filter(d => !foundDesignNos.has(d));
    if (missingDesignNos.length > 0) {
      const reportPath = path.join(notFoundFolderPath, "Missing_Designs.txt");
      const reportContent = `Missing Designs:\n\n${missingDesignNos.join("\n")}`;
      await fs.writeFile(reportPath, reportContent, "utf-8");
    }

    return NextResponse.json({ 
      success: true, 
      folderName: orderFolderName,
      desktopPath: outputFolderPath,
      copiedCount,
      missingCount: missingDesignNos.length,
      missingDesigns: missingDesignNos
    });

  } catch (error) {
    console.error("Gather files error:", error);
    return NextResponse.json({ error: "Failed to gather files" }, { status: 500 });
  }
}
