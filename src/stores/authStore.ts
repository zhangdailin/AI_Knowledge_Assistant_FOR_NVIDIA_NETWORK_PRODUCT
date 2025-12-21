import { create } from 'zustand';
import { localStorageManager, User } from '../lib/localStorage';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  register: (email: string, name: string, password: string) => Promise<boolean>;
  checkAuth: () => void;
}

function makePublicUser(): User {
  return {
    id: 'public',
    email: 'public@example.com',
    name: '访客',
    role: 'user',
    createdAt: new Date().toISOString()
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  user: localStorageManager.getCurrentUser() ?? makePublicUser(),
  isAuthenticated: true,
  isLoading: false,

  login: async (_email: string, _password: string) => {
    const publicUser = makePublicUser();
    localStorageManager.setCurrentUser(publicUser);
    set({ user: publicUser, isAuthenticated: true, isLoading: false });
    return true;
  },

  logout: () => {
    const publicUser = makePublicUser();
    localStorageManager.setCurrentUser(publicUser);
    set({ user: publicUser, isAuthenticated: true });
  },

  register: async (_email: string, _name: string, _password: string) => {
    const publicUser = makePublicUser();
    localStorageManager.setCurrentUser(publicUser);
    set({ user: publicUser, isAuthenticated: true, isLoading: false });
    return true;
  },

  checkAuth: () => {
    let user = localStorageManager.getCurrentUser();
    if (!user) {
      user = makePublicUser();
      localStorageManager.setCurrentUser(user);
    }
    set({ user, isAuthenticated: true });
  }
}));
