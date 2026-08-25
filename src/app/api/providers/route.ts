import { NextResponse } from 'next/server';
import { listProviderStatus } from '@/lib/translate';

export const runtime = 'nodejs';

/** Qaysi provayderlar kalitsiz ishlaydi — client shu ro'yxatga qarab UI chizadi. */
export async function GET() {
  return NextResponse.json({ providers: listProviderStatus() });
}
