import { NextResponse } from "next/server";
import { handleApiError } from '@/lib/errors';

export async function GET() {
  try {
    return NextResponse.json({ message: "Hello, world!" });
  } catch (error) {
    return handleApiError(error);
  }
}
