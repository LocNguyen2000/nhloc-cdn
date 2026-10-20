import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const path = (await params).path.join('/');

  // Optional: check metadata exists
  const { data: asset } = await supabaseAdmin
    .from('assets')
    .select('mime_type')
    .eq('path', path)
    .single();

  if (!asset) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Download from Supabase Storage
  const { data, error } = await supabaseAdmin.storage
    .from('cdn-assets')
    .download(path);

  if (error || !data) {
    return new NextResponse('Not found', { status: 404 });
  }

  const buffer = Buffer.from(await data.arrayBuffer());

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': asset.mime_type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable', // 1 year
      'Access-Control-Allow-Origin': '*',
    },
  });
}