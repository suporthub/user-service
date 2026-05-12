import { prismaRead, prismaWrite } from '../../lib/prisma';

export async function getFavorites(userId: string, userType: string) {
  return prismaRead.userFavoriteSymbol.findMany({
    where: {
      userId,
      userType,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });
}

export async function addFavorite(userId: string, userType: string, symbol: string) {
  return prismaWrite.userFavoriteSymbol.upsert({
    where: {
      userId_userType_symbol: {
        userId,
        userType,
        symbol,
      },
    },
    update: {}, // No change if already exists
    create: {
      userId,
      userType,
      symbol,
    },
  });
}

export async function removeFavorite(userId: string, userType: string, symbol: string) {
  return prismaWrite.userFavoriteSymbol.delete({
    where: {
      userId_userType_symbol: {
        userId,
        userType,
        symbol,
      },
    },
  });
}
