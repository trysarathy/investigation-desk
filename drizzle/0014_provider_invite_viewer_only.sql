-- rc6 integration review: a provider may invite only the read-only Viewer role into a merchant. Roles with authority
-- are granted by the merchant's own Admin, so a provider can never place a person in the merchant's approval chain.
ALTER TABLE merchant_invitations ADD CONSTRAINT merchant_invitations_viewer_only_chk CHECK (role = 'viewer');
