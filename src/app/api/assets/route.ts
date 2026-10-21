import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('assets')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('ids' in payload) ||
    !Array.isArray(payload.ids) ||
    payload.ids.length === 0 ||
    !payload.ids.every(
      (id): id is string =>
        typeof id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
    )
  ) {
    return NextResponse.json({ error: 'A non-empty array of asset IDs is required' }, { status: 400 });
  }

  const ids = [...new Set(payload.ids)];
  const { data: assets, error: lookupError } = await supabaseAdmin
    .from('assets')
    .select('id, path')
    .in('id', ids);

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!assets || assets.length !== ids.length) {
    return NextResponse.json({ error: 'One or more assets were not found' }, { status: 404 });
  }

  const { error: storageError } = await supabaseAdmin.storage
    .from('cdn-assets')
    .remove(assets.map((asset) => asset.path));

  if (storageError) {
    return NextResponse.json({ error: storageError.message }, { status: 500 });
  }

  const { data: deletedAssets, error: deleteError } = await supabaseAdmin
    .from('assets')
    .delete()
    .in('id', ids)
    .select('id');

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }
  if (!deletedAssets || deletedAssets.length !== ids.length) {
    return NextResponse.json({ error: 'Not all asset records could be deleted' }, { status: 500 });
  }

  return NextResponse.json({ deletedCount: deletedAssets.length });
}