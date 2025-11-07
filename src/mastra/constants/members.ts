import membersData from '../data/mastra-members.json';

interface Member {
  login: string;
  name: string | null;
  tfa_enabled: boolean;
  is_public: boolean;
  role: string;
  saml_name_id: string | null;
  tfa_level: string;
  organization_roles_count: number;
}

export const members = new Map<string, Member>(membersData.map(member => [member.login, member as Member]));

export const getMemberByLogin = (login: string): Member | undefined => {
  return members.get(login);
};

export const getMembersByRole = (role: string): Member[] => {
  return Array.from(members.values()).filter(member => member.role === role);
};

export const getOwners = (): Member[] => {
  return getMembersByRole('Owner');
};

export const getMembers = (): Member[] => {
  return getMembersByRole('Member');
};
