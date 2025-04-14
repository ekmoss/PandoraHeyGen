import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(request: Request) {
  try {
    // Get data from request
    const data = await request.json();

    if (!data) {
      return NextResponse.json({ error: "No data provided" }, { status: 400 });
    }

    // Add timestamp if not present
    const timestamp = data.timestamp || new Date().toISOString();
    const formattedTimestamp = timestamp.replace(/[:.]/g, "-");

    // Create the directory if it doesn't exist
    const logDir = path.join(process.cwd(), "app/test-voice");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Create log file name based on test type and timestamp
    const fileName = `latency-optimization-log-${formattedTimestamp}.txt`;
    const filePath = path.join(logDir, fileName);

    // Format the data as markdown-style text for better readability
    let logContent = `# Latency Optimization Log\n\n`;
    logContent += `## Test Summary\n`;
    logContent += `- Timestamp: ${timestamp}\n`;
    logContent += `- Total Latency: ${data.totalLatency?.toFixed(2)}ms\n\n`;

    if (data.transcribedText) {
      logContent += `## Transcription\n\`\`\`\n${data.transcribedText}\n\`\`\`\n\n`;
    }

    if (data.aiResponse) {
      logContent += `## AI Response\n\`\`\`\n${data.aiResponse}\n\`\`\`\n\n`;
    }

    if (data.error) {
      logContent += `## Errors\n\`\`\`\n${data.error}\n\`\`\`\n\n`;
    }

    // Add client-side performance metrics
    if (data.clientMetrics?.length > 0) {
      logContent += `## Client-Side Performance Metrics\n`;
      logContent += `| Step | Duration | % of Total |\n`;
      logContent += `|------|----------|------------|\n`;

      data.clientMetrics.forEach((metric: any) => {
        const percentage = data.totalLatency
          ? ((metric.duration / data.totalLatency) * 100).toFixed(1) + "%"
          : "N/A";

        logContent += `| ${metric.step} | ${metric.duration.toFixed(2)}ms | ${percentage} |\n`;
      });

      logContent += `\n`;
    }

    // Add transcription API metrics
    if (data.transcriptionMetrics) {
      logContent += `## Transcription API Metrics\n`;
      logContent += `| Step | Duration | % of Total |\n`;
      logContent += `|------|----------|------------|\n`;

      const total = data.transcriptionMetrics.total || 0;

      Object.entries(data.transcriptionMetrics)
        .filter(([key]) => key !== "total")
        .forEach(([key, value]) => {
          const duration = Number(value);
          const percentage = total
            ? ((duration / total) * 100).toFixed(1) + "%"
            : "N/A";

          logContent += `| ${key} | ${duration.toFixed(2)}ms | ${percentage} |\n`;
        });

      if (total) {
        logContent += `| **Total** | **${total.toFixed(2)}ms** | **100%** |\n`;
      }

      logContent += `\n`;
    }

    // Add Chat API metrics
    if (data.chatMetrics) {
      logContent += `## Chat API Metrics\n`;
      logContent += `| Step | Duration | % of Total |\n`;
      logContent += `|------|----------|------------|\n`;

      const total = data.chatMetrics.total || 0;

      Object.entries(data.chatMetrics)
        .filter(([key]) => key !== "total")
        .forEach(([key, value]) => {
          const duration = Number(value);
          const percentage = total
            ? ((duration / total) * 100).toFixed(1) + "%"
            : "N/A";

          logContent += `| ${key} | ${duration.toFixed(2)}ms | ${percentage} |\n`;
        });

      if (total) {
        logContent += `| **Total** | **${total.toFixed(2)}ms** | **100%** |\n`;
      }

      logContent += `\n`;
    }

    // Add audio details
    if (data.audioDetails) {
      logContent += `## Audio Recording Details\n`;
      logContent += `- Chunk Duration: ${data.audioDetails.chunkDuration}ms\n`;
      logContent += `- MIME Type: ${data.audioDetails.mimeType}\n`;
      logContent += `- Total Chunks: ${data.audioDetails.totalChunks}\n\n`;
    }

    // Write to file
    fs.writeFileSync(filePath, logContent);

    return NextResponse.json({
      success: true,
      filePath: `/test-voice/${fileName}`,
      message: `Test results saved to ${fileName}`,
    });
  } catch (error) {
    console.error("Error saving test results:", error);
    return NextResponse.json(
      {
        error: `Failed to save test results: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
