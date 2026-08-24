export type RecruiterAccountCartItem = {
  memberId: string;
  publicId: string;
  jobRole: string;
};

export type RecruiterAccountRequestItem = {
  id: string;
  publicId: string;
  status: string;
  jobRole: string | null;
};

export type RecruiterAccountSnapshot = {
  fullName: string;
  company: string;
  email: string | null;
  cart: RecruiterAccountCartItem[];
  cartCount: number;
  requests: RecruiterAccountRequestItem[];
  requestCount: number;
};
