"use client";

import React, { useState } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileDown, RefreshCw, AlertCircle, CheckCircle, LogIn, Folder } from "lucide-react";

interface ExtractedItem {
  designNo: string;
  qty: string;
}

export default function PDFExtractor() {
  const [data, setData] = useState<ExtractedItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<{ url: string; title: string } | null>(null);
  const [gathering, setGathering] = useState<boolean>(false);
  const [pasteInput, setPasteInput] = useState<string>("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [gatherResult, setGatherResult] = useState<{ folderName: string, copiedCount: number, missingCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Google Login ─────────────────────────────────────────────────────────────
  const googleLogin = useGoogleLogin({
    onSuccess: (response) => {
      setAccessToken(response.access_token);
      setError(null);
    },
    onError: () => setError("Google login failed. Please try again."),
    scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file",
  });

  const processPDF = async (file: File) => {
    setLoading(true);
    setFileName(file.name);
    setError(null);

    try {
      const pdfjsLib = await import("pdfjs-dist");

      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();

      const arrayBuffer = await file.arrayBuffer();

      const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
      }).promise;

      let designColumnX: number | null = null;
      let qtyColumnX: number | null = null;

      const DESIGN_TOLERANCE = 35;
      const QTY_TOLERANCE = 15;
      const ROW_TOLERANCE = 2;

      const rows: {
        designNo: string;
        qty: string;
      }[] = [];

      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);
        const textContent = await page.getTextContent();
        const items = textContent.items as any[];

        // Detect headers once
        if (designColumnX === null || qtyColumnX === null) {
          for (const item of items) {
            const text = item.str.trim();

            if (text === "Design No.") {
              designColumnX = item.transform[4];
              console.log(designColumnX);
              
            }

            if (text === "Qty") {
              qtyColumnX = item.transform[4];
            }
          }
        }

        if (designColumnX === null || qtyColumnX === null) {
          continue;
        }

        const rowMap = new Map<
          number,
          {
            designNo?: string;
            qty?: string;
          }
        >();

        for (const item of items) {
          const text = item.str.trim();

          if (!text) continue;

          const x = item.transform[4];
          const y = Number(item.transform[5].toFixed(1));

          // Find nearby row (handles tiny Y differences)
          let rowKey = [...rowMap.keys()].find(
            (k) => Math.abs(k - y) <= ROW_TOLERANCE
          );

          if (rowKey === undefined) {
            rowKey = y;
            rowMap.set(rowKey, {});
          }

          const row = rowMap.get(rowKey)!;

          if (Math.abs(x - designColumnX) <= DESIGN_TOLERANCE) {
            row.designNo = text;
          }

          if (Math.abs(x - qtyColumnX) <= QTY_TOLERANCE) {
            row.qty = text;
          }
        }

        for (const row of rowMap.values()) {
          if (!row.designNo) continue;

          rows.push({
            designNo: row.designNo,
            qty: row.qty ?? "1",
          });
        }
      }

      const parsed = parsePDFRows(rows);

      setData(parsed);
      setExportResult(null);
    } catch (err) {
      console.error(err);
      setError("Failed to read PDF.");
    } finally {
      setLoading(false);
    }
  };

  // ── PDF Parsing ───────────────────────────────────────────────────────────────
  const parsePDFRows = (
    rows: {
      designNo: string;
      qty: string;
    }[]
  ) => {
    return rows
      .map((row) => {
        let designNo = row.designNo.trim();

        if (!designNo || designNo === "Design No.") {
          return null;
        }

        // Remove ".jpg..."
        designNo = designNo.replace(/\.jpg.*$/i, "");

        // Remove "-c"
        designNo = designNo.replace(/-c$/i, "");

        // WH12614 -> WH-12614
        // DZER12614 -> DZER-12614
        if (/^(WH|DZ)/i.test(designNo) && !designNo.includes("-")) {
          designNo = designNo.replace(
            /^([A-Za-z]+)(\d+)$/,
            "$1-$2"
          );
        }

        // Validate
        if (!/^[A-Za-z]{2,6}-?\d+$/.test(designNo)) {
          return null;
        }

        const qty = parseInt(row.qty, 10);

        return {
          designNo,
          qty: Number.isNaN(qty) ? "1" : qty.toString(),
        };
      })
      .filter(Boolean) as {
        designNo: string;
        qty: string;
      }[];
  };

  const handleDrop = async (
    e: React.DragEvent<HTMLDivElement>
  ) => {
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];

    if (file && file.type === "application/pdf") {
      await processPDF(file);
    }
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => {
    setDragActive(false);
  };

  // ── Export to Google Sheets ───────────────────────────────────────────────────
  const exportToGoogleSheets = async () => {
    if (!accessToken) {
      googleLogin();
      return;
    }

    if (data.length === 0) return;

    setExporting(true);
    setError(null);

    try {
      const response = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          data,
          fileName,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        // Token may have expired — re-login
        if (response.status === 401) {
          setAccessToken(null);
          setError("Session expired. Please login again.");
        } else {
          setError(result.error || "Export failed.");
        }
        return;
      }

      setExportResult({
        url: result.spreadsheetUrl,
        title: result.title,
      });
    } catch (err) {
      console.error("Export error:", err);
      setError("Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // ── Gather Files ──────────────────────────────────────────────────────────────
  const gatherFiles = async () => {
    if (data.length === 0) return;
    setGathering(true);
    setError(null);
    setGatherResult(null);

    try {
      const response = await fetch("/api/gather-files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          items: data.map((item) => ({
            designNo: item.designNo,
            qty: item.qty,
          })),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Failed to gather files.");
        return;
      }

      setGatherResult({
        folderName: result.folderName,
        copiedCount: result.copiedCount,
        missingCount: result.missingCount,
      });
    } catch (err) {
      console.error("Gather files error:", err);
      setError("Failed to gather files. Please try again.");
    } finally {
      setGathering(false);
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (!file) return;

    await processPDF(file);
  };

  const totalQty = data.reduce(
    (sum, item) => sum + Number(item.qty || 0),
    0
  );

  const handlePasteSearch = () => {
    setPasteError(null);

    const lines = pasteInput
      .split(/[\n,]+/)
      .map((l) => l.replace(/\.[a-zA-Z0-9]+$/, "").trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setPasteError("Please paste at least one Design No.");
      return;
    }

    const items: ExtractedItem[] = lines.map((designNo) => ({
      designNo,
      qty: "1",
    }));

    setData(items);
    setFileName("manual-paste");
    setExportResult(null);
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <header className="space-y-2 text-center sm:text-left">
        <h1 className="text-3xl font-bold tracking-tight">PDF Order Extractor</h1>
        <p className="text-muted-foreground">
          Upload order PDFs to extract Design Numbers and export directly to Google Sheets.
        </p>
      </header>

      {/* Google Login Status */}
      <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2 text-sm">
          {accessToken ? (
            <>
              <CheckCircle className="h-4 w-4 text-green-600" />
              <span className="text-green-700 font-medium">Google account connected</span>
            </>
          ) : (
            <>
              <LogIn className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Connect Google account to export sheets</span>
            </>
          )}
        </div>
        {!accessToken && (
          <Button variant="outline" size="sm" onClick={() => googleLogin()}>
            Connect Google
          </Button>
        )}
      </div>

      {/* Upload Area */}
      <Card
        className={`border-2 border-dashed cursor-pointer transition-all ${dragActive
          ? "border-primary bg-primary/5"
          : "border-muted"
          }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <CardContent className="flex flex-col items-center justify-center p-10 space-y-4 text-center">
          <Upload className="h-10 w-10 text-primary" />

          <div>
            <p className="font-medium">
              Drag & Drop PDF Here
            </p>

            <p className="text-sm text-muted-foreground">
              or click below to select a file
            </p>
          </div>

          <label htmlFor="pdf-upload">
            <Button asChild>
              <span>Choose PDF</span>
            </Button>

            <input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Or paste Design Numbers manually</CardTitle>
          <CardDescription>One per line, or comma-separated. e.g. DZER-11742, TRBL-008</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
            placeholder={"DZER-11742\nDZER-11743\nTRBL-008"}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {pasteError && (
            <p className={`text-xs ${pasteError.startsWith("Loaded") ? "text-amber-600" : "text-red-600"}`}>
              {pasteError}
            </p>
          )}
          <Button onClick={handlePasteSearch} className="w-full sm:w-auto">
            Find these items
          </Button>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 text-red-800 text-sm border border-red-200">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Export Success */}
      {exportResult && (
        <div className="flex items-center justify-between p-4 rounded-lg bg-green-50 border border-green-200">
          <div className="flex items-center gap-2 text-green-800 text-sm">
            <CheckCircle className="h-5 w-5 shrink-0" />
            <span>Sheet created: <strong>{exportResult.title}</strong></span>
          </div>
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={() => window.open(exportResult.url, "_blank")}
          >
            Open Sheet
          </Button>
        </div>
      )}

      {/* Gather Success */}
      {gatherResult && (
        <div className="flex items-center justify-between p-4 rounded-lg bg-blue-50 border border-blue-200">
          <div className="flex items-center gap-2 text-blue-800 text-sm">
            <CheckCircle className="h-5 w-5 shrink-0" />
            <span>
              Files gathered to Desktop: <strong>{gatherResult.folderName}</strong> ({gatherResult.copiedCount} found, {gatherResult.missingCount} missing)
            </span>
          </div>
        </div>
      )}

      {/* Results Table */}
      {data.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle>Extracted Results</CardTitle>
              <CardDescription>Found {data.length} design numbers.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={gatherFiles}
                disabled={gathering}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              >
                {gathering ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" /> Gathering...</>
                ) : (
                  <><Folder className="h-4 w-4" /> Gather Files</>
                )}
              </Button>
              <Button
                onClick={exportToGoogleSheets}
                disabled={exporting}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {exporting ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" /> Creating Sheet...</>
                ) : (
                  <><FileDown className="h-4 w-4" /> Export to Google Sheets</>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Sr.</TableHead>
                    <TableHead>Design No.</TableHead>
                    <TableHead>Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item, index) => (
                    <React.Fragment key={index}>
                      <TableRow>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        <TableCell className="font-mono font-medium">{item.designNo}</TableCell>
                        <TableCell>{item.qty}</TableCell>
                      </TableRow>
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 flex ">
                <div className="rounded-md border px-4 py-2 bg-muted/30">
                  <span className="font-medium">Total : </span>
                  <span className="font-bold text-lg">{totalQty}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Results */}
      {data.length === 0 && fileName && !loading && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-amber-50 text-amber-800 text-sm border border-amber-200">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>
            No design numbers found. Make sure the PDF is text-based and contains codes like TRBL011 or TRTP016.
          </span>
        </div>
      )}
    </div>
  );
}
