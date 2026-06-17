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

  // ── PDF Parsing ───────────────────────────────────────────────────────────────
  const parsePDFText = (text: string) => {
    const items: ExtractedItem[] = [];
    const seen = new Set<string>();

    const designRegex = /\b(TR[A-Z]{2}\d{3})\b/g;
    const matches = text.matchAll(designRegex);

    for (const match of matches) {
      const designNo = match[1];
      if (!seen.has(designNo)) {
        seen.add(designNo);
        items.push({ designNo, qty: "1" });
      }
    }

    return items;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

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
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pageText = textContent.items.map((item: any) => item.str).join(" ");
        fullText += pageText + "\n";
      }

      const items = parsePDFText(fullText);
      setData(items);
      setExportResult(null);
    } catch (err) {
      console.error("Error reading PDF:", err);
      setError("Failed to read PDF. Make sure it is a text-based PDF.");
    } finally {
      setLoading(false);
    }
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          designNos: data.map((item) => item.designNo),
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
      <Card className="border-dashed border-2">
        <CardContent className="flex flex-col items-center justify-center p-10 space-y-4 text-center">
          <div className="p-4 bg-primary/10 rounded-full text-primary">
            {loading ? <RefreshCw className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" />}
          </div>
          <div className="space-y-1">
            <p className="font-medium text-sm">
              {fileName ? `Selected: ${fileName}` : "Click to upload your order PDF"}
            </p>
            <p className="text-xs text-muted-foreground">
              Extracts Design Numbers like TRBL011, TRTP016 from text-based PDFs
            </p>
          </div>
          <label htmlFor="pdf-upload">
            <Button asChild variant={fileName ? "secondary" : "default"} disabled={loading}>
              <span>
                {loading ? "Processing..." : fileName ? "Change File" : "Choose File"}
              </span>
            </Button>
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileUpload}
              disabled={loading}
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