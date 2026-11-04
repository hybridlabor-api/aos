import { NextResponse } from 'next/server';

export async function GET(request, { params }) {
  return NextResponse.json({ id: params.id });
}

export async function POST(request) {
  return NextResponse.json({ created: true });
}
