import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const path = (formData.get('path') as string) || file?.name;

  if (!file || !path) {
    return NextResponse.json({ error: 'file and path required' }, { status: 400 });
  }

  // Upload to Supabase Storage
  const { error: uploadError } = await supabaseAdmin.storage
    .from('cdn-assets')
    .upload(path, file, {
      contentType: file.type,
      upsert: true, // overwrite if exists
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  // Record metadata
  const { data, error: dbError } = await supabaseAdmin
    .from('assets')
    .upsert({
      path,
      filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select()
    .single();

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  // Public URL from Supabase
  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('cdn-assets')
    .getPublicUrl(path);

  return NextResponse.json({
    id: data.id,
    path,
    url: publicUrl,                    // direct Supabase URL
    cdnUrl: `/cdn/${encodeURIComponent(path)}`, // proxied version
  });
}