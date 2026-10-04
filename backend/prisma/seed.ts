/**
 * Seed data: default admin + a demo match (India vs Australia) plus reusable
 * graphics templates. Safe to run repeatedly.
 *
 *   npm run db:seed   (from the backend workspace)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SQUAD_A = [
  { name: 'R Sharma', role: 'BAT' as const, jerseyNumber: 45 },
  { name: 'S Gill', role: 'BAT' as const, jerseyNumber: 77 },
  { name: 'V Kohli', role: 'BAT' as const, jerseyNumber: 18 },
  { name: 'S Iyer', role: 'BAT' as const, jerseyNumber: 96 },
  { name: 'K Rahul', role: 'WK' as const, jerseyNumber: 1 },
  { name: 'H Pandya', role: 'AR' as const, jerseyNumber: 33 },
  { name: 'R Jadeja', role: 'AR' as const, jerseyNumber: 8 },
  { name: 'K Yadav', role: 'BOWL' as const, jerseyNumber: 3 },
  { name: 'M Shami', role: 'BOWL' as const, jerseyNumber: 11 },
  { name: 'J Bumrah', role: 'BOWL' as const, jerseyNumber: 93 },
  { name: 'M Siraj', role: 'BOWL' as const, jerseyNumber: 73 },
];

const SQUAD_B = [
  { name: 'D Warner', role: 'BAT' as const, jerseyNumber: 31 },
  { name: 'T Head', role: 'BAT' as const, jerseyNumber: 62 },
  { name: 'M Marsh', role: 'AR' as const, jerseyNumber: 8 },
  { name: 'S Smith', role: 'BAT' as const, jerseyNumber: 49 },
  { name: 'M Labuschagne', role: 'BAT' as const, jerseyNumber: 33 },
  { name: 'G Maxwell', role: 'AR' as const, jerseyNumber: 32 },
  { name: 'A Carey', role: 'WK' as const, jerseyNumber: 5 },
  { name: 'P Cummins', role: 'BOWL' as const, jerseyNumber: 30 },
  { name: 'M Starc', role: 'BOWL' as const, jerseyNumber: 56 },
  { name: 'A Zampa', role: 'BOWL' as const, jerseyNumber: 88 },
  { name: 'J Hazlewood', role: 'BOWL' as const, jerseyNumber: 38 },
];

async function main() {
  // ---------------------------------------------------------------- users
  const email = (process.env.DEFAULT_ADMIN_EMAIL ?? 'admin@matchcast.local').toLowerCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD ?? 'ChangeMeNow123!';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    await prisma.user.create({
      data: { email, name: 'Admin', passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN' },
    });
    console.log(`[seed] admin user created: ${email} / ${password}`);
  } else {
    console.log(`[seed] admin user already exists: ${email}`);
  }

  // -------------------------------------------------------------- templates
  const templates = [
    { name: 'cricket-modern', description: 'Glass scoreboard with live badge', previewColor: '#00d09c' },
    { name: 'cricket-classic', description: 'Traditional broadcast bar', previewColor: '#f59e0b' },
    { name: 'cricket-minimal', description: 'Slim score bug', previewColor: '#38bdf8' },
  ];
  for (const t of templates) {
    await prisma.graphicsTemplate.upsert({
      where: { name: t.name },
      create: { ...t, config: { templateId: t.name, accentColor: t.previewColor }, isBuiltIn: true },
      update: { description: t.description, previewColor: t.previewColor },
    });
  }
  console.log('[seed] graphics templates ready');

  // ------------------------------------------------------------ demo match
  const demoTitle = 'India vs Australia - Demo T20';
  const existingMatch = await prisma.match.findFirst({ where: { title: demoTitle } });
  if (existingMatch) {
    console.log('[seed] demo match already exists');
    return;
  }

  const match = await prisma.match.create({
    data: {
      title: demoTitle,
      tournament: 'MatchCast Demo Series',
      venue: 'Kanpur',
      format: 'T20',
      oversPerInnings: 20,
      status: 'SCHEDULED',
      teamA: {
        create: {
          name: 'India',
          shortName: 'IND',
          primaryColor: '#1d4ed8',
          secondaryColor: '#f97316',
          players: { create: SQUAD_A },
        },
      },
      teamB: {
        create: {
          name: 'Australia',
          shortName: 'AUS',
          primaryColor: '#facc15',
          secondaryColor: '#047857',
          players: { create: SQUAD_B },
        },
      },
    },
    include: { teamA: { include: { players: true } }, teamB: { include: { players: true } } },
  });

  const striker = match.teamA.players.find((p) => p.name === 'R Sharma')!;
  const nonStriker = match.teamA.players.find((p) => p.name === 'S Gill')!;
  const bowler = match.teamB.players.find((p) => p.name === 'M Starc')!;

  await prisma.innings.create({
    data: {
      matchId: match.id,
      number: 1,
      battingTeamId: match.teamAId,
      bowlingTeamId: match.teamBId,
      strikerId: striker.id,
      nonStrikerId: nonStriker.id,
      bowlerId: bowler.id,
    },
  });
  await prisma.match.update({
    where: { id: match.id },
    data: { battingTeamId: match.teamAId, bowlingTeamId: match.teamBId },
  });

  console.log(`[seed] demo match created: ${match.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
