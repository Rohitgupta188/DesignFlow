import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

interface Item {
  designNo: string;
  qty: string;
}

interface SearchResult {
  itemPath: string;
  matchedDesign: string;
  isDirectory: boolean;
}

// Recursive search
async function searchFiles(
  dir: string,
  designNos: string[]
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    const entries = await fs.readdir(dir, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      let matched = false;

      for (const designNo of designNos) {
        if (
          entry.name
            .toLowerCase()
            .includes(designNo.toLowerCase())
        ) {
          results.push({
            itemPath: fullPath,
            matchedDesign: designNo,
            isDirectory: entry.isDirectory(),
          });

          matched = true;
          break;
        }
      }

      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules"
        ) {
          continue;
        }

        if (!matched) {
          const subResults = await searchFiles(
            fullPath,
            designNos
          );

          results.push(...subResults);
        }
      }
    }
  } catch (err) {
    console.error(
      `Error reading directory ${dir}:`,
      err
    );
  }

  return results;
}

export async function POST(req: Request) {
  try {
    const { items }: { items: Item[] } =
      await req.json();

    if (
      !items ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return NextResponse.json(
        {
          error: "Invalid or empty items array",
        },
        { status: 400 }
      );
    }

    const designNos = items.map(
      (item) => item.designNo
    );

    const qtyMap = new Map<string, number>();

    for (const item of items) {
      qtyMap.set(
        item.designNo,
        Number(item.qty || "1")
      );
    }

    // Search directories from env
    const searchDirsRaw =
      process.env.SEARCH_DIRECTORIES || "";

    const searchDirs = searchDirsRaw
      .replace(/^["']|["']$/g, "")
      .split(";")
      .flatMap((d) => d.split(","))
      .map((d) => d.trim())
      .filter(Boolean);

    if (searchDirs.length === 0) {
      return NextResponse.json(
        {
          error:
            "No SEARCH_DIRECTORIES configured",
        },
        { status: 500 }
      );
    }

    // Create output folder
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

    const orderFolderName = `Order_${timestamp}`;

    const desktopPath = path.join(
      os.homedir(),
      "Desktop"
    );

    const outputFolderPath = path.join(
      desktopPath,
      orderFolderName
    );

    const foundFolderPath = path.join(
      outputFolderPath,
      "Found"
    );

    const notFoundFolderPath = path.join(
      outputFolderPath,
      "Not_Found"
    );

    await fs.mkdir(foundFolderPath, {
      recursive: true,
    });

    await fs.mkdir(notFoundFolderPath, {
      recursive: true,
    });

    // Search all directories
    const allFoundFiles: SearchResult[] = [];

    for (const searchDir of searchDirs) {
      try {
        const stats = await fs.stat(searchDir);

        if (stats.isDirectory()) {
          const found = await searchFiles(
            searchDir,
            designNos
          );

          allFoundFiles.push(...found);
        }
      } catch (err) {
        console.error(
          `Invalid search directory: ${searchDir}`,
          err
        );
      }
    }

    const foundDesignNos = new Set<string>();

    let copiedCount = 0;

    // Copy results
    for (const result of allFoundFiles) {
      const {
        itemPath,
        matchedDesign,
        isDirectory,
      } = result;

      try {
        const qty =
          qtyMap.get(matchedDesign) || 1;

        const originalName =
          path.basename(itemPath);

        const ext =
          path.extname(originalName);

        const baseName =
          path.basename(
            originalName,
            ext
          );

        for (
          let i = 1;
          i <= qty;
          i++
        ) {
          const copyName =
            qty > 1
              ? `${baseName}-${i}${ext}`
              : originalName;

          const destPath = path.join(
            foundFolderPath,
            copyName
          );

          if (isDirectory) {
            await fs.cp(
              itemPath,
              destPath,
              {
                recursive: true,
              }
            );
          } else {
            await fs.copyFile(
              itemPath,
              destPath
            );
          }

          copiedCount++;
        }

        foundDesignNos.add(
          matchedDesign
        );
      } catch (err) {
        console.error(
          `Failed copying ${itemPath}`,
          err
        );
      }
    }

    // Missing designs
    const missingDesignNos =
      designNos.filter(
        (d) => !foundDesignNos.has(d)
      );

    if (
      missingDesignNos.length > 0
    ) {
      const reportPath =
        path.join(
          notFoundFolderPath,
          "Missing_Designs.txt"
        );

      await fs.writeFile(
        reportPath,
        missingDesignNos.join("\n"),
        "utf8"
      );
    }

    return NextResponse.json({
      success: true,
      folderName: orderFolderName,
      desktopPath: outputFolderPath,
      copiedCount,
      missingCount:
        missingDesignNos.length,
      missingDesigns:
        missingDesignNos,
    });
  } catch (error) {
    console.error(
      "Gather files error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to gather files",
      },
      { status: 500 }
    );
  }
}