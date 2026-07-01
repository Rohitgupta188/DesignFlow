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

      const designItems: string[] = [];

      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        const page = await pdf.getPage(pageNo);

        const textContent = await page.getTextContent();

        textContent.items.forEach((item: any) => {
          const text = item.str.trim();

          if (!text) return;

          const x = item.transform[4];

          // Design No column
          if (x >= 160 && x <= 180) {
            designItems.push(text);
          }
        });
      }

      const items = parsePDFText(designItems);

      setData(items);
      setExportResult(null);
    } catch (err) {
      console.error(err);
      setError("Failed to read PDF.");
    } finally {
      setLoading(false);
    }
  };

  // ── PDF Parsing ───────────────────────────────────────────────────────────────
  const parsePDFText = (designItems: string[]) => {
    const qtyMap = new Map<string, number>();

    for (let designNo of designItems) {
      designNo = designNo.trim();

      if (!designNo) continue;

      // Ignore the table header
      if (designNo === "Design No.") continue;

      // Same normalization logic
      // DZGR26565 -> DZGR-26565
      if (designNo.startsWith("DZ") && !designNo.includes("-")) {
        designNo = designNo.replace(/^([A-Z]{4})(\d+)$/, "$1-$2");
      }

      // WH26565 -> WH-26565
      if (designNo.startsWith("WH") && !designNo.includes("-")) {
        designNo = designNo.replace(/^([A-Z]{2})(\d+)$/, "$1-$2");
      }

      // Same validation
      if (!/^[A-Z]{2,6}-?\d+$/.test(designNo)) continue;

      qtyMap.set(designNo, (qtyMap.get(designNo) || 0) + 1);
    }

    return Array.from(qtyMap.entries()).map(([designNo, qty]) => ({
      designNo,
      qty: qty.toString(),
    }));
  };

  const handleDrop = async (
    e: React.DragEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
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
