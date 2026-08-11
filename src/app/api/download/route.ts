import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const zipPath = '/home/z/my-project/public/project-download.zip'
    const zipBuffer = readFileSync(zipPath)
    const fileName = `project-source-${new Date().toISOString().slice(0, 10)}.zip`

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': String(zipBuffer.length),
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('[Download] Error:', error)
    return NextResponse.json({ error: 'Failed to serve project ZIP' }, { status: 500 })
  }
}
