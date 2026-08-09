import 'next-auth';

declare module 'next-auth' {
  interface User {
    gitlabUserId?: number;
    username?: string | null;
    avatarUrl?: string | null;
  }
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      gitlabUserId?: number;
      username?: string | null;
    };
  }
}
