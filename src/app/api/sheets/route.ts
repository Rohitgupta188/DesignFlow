import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

export async function POST(req: NextRequest) {
  try {
    const { accessToken, data, fileName } = await req.json();

    if (!accessToken) {
      return NextResponse.json({ error: "No access token provided." }, { status: 401 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "No data to export." }, { status: 400 });
    }

    // ── Setup Google Auth with user's access token ─────────────────────────────
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });

    const sheets = google.sheets({ version: "v4", auth });
    const drive = google.drive({ version: "v3", auth });

    // ── Create new spreadsheet ─────────────────────────────────────────────────
    const sheetTitle = fileName
      ? `BJ Order - ${fileName.replace(".pdf", "")} - ${new Date().toLocaleDateString("en-IN")}`
      : `BJ Order Extract - ${new Date().toLocaleDateString("en-IN")}`;

    const createResponse = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: sheetTitle,
        },
        sheets: [
          {
            properties: {
              title: "Design Numbers",
              gridProperties: {
                frozenRowCount: 1,
              },
            },
          },
        ],
      },
    });

    const spreadsheetId = createResponse.data.spreadsheetId!;
    const spreadsheetUrl = createResponse.data.spreadsheetUrl!;
    const sheetId = createResponse.data.sheets?.[0]?.properties?.sheetId ?? 0;

    // ── Write data ─────────────────────────────────────────────────────────────
    const rows = [
      ["Sr. No.", "Design No.", "Quantity", "Remarks"],
      ...data.map((item: { designNo: string; qty: string }, index: number) => [
        index + 1,
        item.designNo,
        parseInt(item.qty) || 1,
        "",
      ]),
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Design Numbers!A1",
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });

    // ── Format header row ──────────────────────────────────────────────────────
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // Bold header
          {
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { 
                    bold: true,
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                  },
                  backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
                  horizontalAlignment: "CENTER",
                },
              },
              fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)",
            },
          },
          // Auto resize columns
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId,
                dimension: "COLUMNS",
                startIndex: 0,
                endIndex: 4,
              },
            },
          },
        ],
      },
    });

    return NextResponse.json({
      success: true,
      spreadsheetId,
      spreadsheetUrl,
      title: sheetTitle,
      rowsWritten: data.length,
    });
  } catch (error: unknown) {
    console.error("Google Sheets error:", error);
    const message = error instanceof Error ? error.message : "Failed to create sheet.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}