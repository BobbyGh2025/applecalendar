import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { authenticate } from '@/lib/auth';
import { handleApiError, ApiError } from '@/lib/errors';
import { updateOrganizerProfileSchema } from '@/lib/validations';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * GET /api/organizer/profile
 * Return the authenticated organizer's OrganizerProfile.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);

    if (user.role !== 'ORGANIZER' && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'Organizer access required');
    }

    const profile = await db.organizerProfile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      return NextResponse.json({ profile: null });
    }

    return NextResponse.json({ profile });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PATCH /api/organizer/profile
 * Create or update OrganizerProfile (only for ORGANIZER role).
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await authenticate(request);

    if (user.role !== 'ORGANIZER' && user.role !== 'SUPER_ADMIN') {
      throw new ApiError(403, 'FORBIDDEN', 'Organizer access required');
    }

    const body = await request.json();

    const parsed = updateOrganizerProfileSchema.safeParse(body);
    if (!parsed.success) {
      return ApiError.fromZodError(parsed.error).toResponse();
    }

    const existingProfile = await db.organizerProfile.findUnique({
      where: { userId: user.id },
    });

    if (existingProfile) {
      // Update existing profile
      const updateData: Record<string, unknown> = {};
      const { organizationName, description, logo, coverImage, website, contactEmail, phone, address, city, state, country, socialLinks } = parsed.data;

      if (organizationName !== undefined) updateData.organizationName = organizationName;
      if (description !== undefined) updateData.description = description;
      if (logo !== undefined) updateData.logo = logo || null;
      if (coverImage !== undefined) updateData.coverImage = coverImage || null;
      if (website !== undefined) updateData.website = website || null;
      if (contactEmail !== undefined) updateData.contactEmail = contactEmail || null;
      if (phone !== undefined) updateData.phone = phone;
      if (address !== undefined) updateData.address = address;
      if (city !== undefined) updateData.city = city;
      if (state !== undefined) updateData.state = state;
      if (country !== undefined) updateData.country = country;
      if (socialLinks !== undefined) updateData.socialLinks = JSON.stringify(socialLinks);

      // Regenerate slug if name changed
      if (organizationName !== undefined) {
        let slug = slugify(organizationName);
        const existingSlug = await db.organizerProfile.findFirst({ where: { slug, NOT: { id: existingProfile.id } } });
        if (existingSlug) slug = `${slug}-${Date.now()}`;
        updateData.slug = slug;
      }

      const profile = await db.organizerProfile.update({
        where: { id: existingProfile.id },
        data: updateData,
      });

      return NextResponse.json({ profile });
    } else {
      // Create new profile
      const { organizationName, description, logo, coverImage, website, contactEmail, phone, address, city, state, country, socialLinks } = parsed.data;

      if (!organizationName) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Organization name is required to create a profile');
      }

      let slug = slugify(organizationName);
      const existingSlug = await db.organizerProfile.findUnique({ where: { slug } });
      if (existingSlug) slug = `${slug}-${Date.now()}`;

      const profile = await db.organizerProfile.create({
        data: {
          userId: user.id,
          organizationName,
          slug,
          description: description || null,
          logo: logo || null,
          coverImage: coverImage || null,
          website: website || null,
          contactEmail: contactEmail || null,
          phone: phone || null,
          address: address || null,
          city: city || null,
          state: state || null,
          country: country || null,
          socialLinks: socialLinks ? JSON.stringify(socialLinks) : null,
          approvalStatus: 'PENDING',
        },
      });

      return NextResponse.json({ profile }, { status: 201 });
    }
  } catch (error) {
    return handleApiError(error);
  }
}
