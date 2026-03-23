import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Delete Account — Rallia',
  description: 'Learn how to delete your Rallia account and all associated data.',
};

export default function DeleteAccountPage() {
  return (
    <div className="flex flex-col w-full gap-8 pb-16 max-w-2xl">
      <h1 className="text-3xl sm:text-4xl font-bold">Delete Your Account</h1>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">How to delete your account</h2>
        <p className="text-muted-foreground">
          You can delete your Rallia account directly from the mobile app:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
          <li>Open the Rallia app</li>
          <li>
            Go to <strong>Settings</strong>
          </li>
          <li>
            Scroll down and tap <strong>Delete Account</strong>
          </li>
          <li>Confirm the deletion when prompted</li>
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">What happens when you delete your account</h2>
        <p className="text-muted-foreground">
          Deleting your account will permanently remove all your data, including:
        </p>
        <ul className="list-disc list-inside space-y-2 text-muted-foreground">
          <li>Your profile and profile picture</li>
          <li>Your match history</li>
          <li>Your messages and chat history</li>
          <li>Your community memberships</li>
          <li>Your sport ratings and preferences</li>
        </ul>
        <p className="text-muted-foreground font-medium">
          This action is permanent and cannot be undone.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Need help?</h2>
        <p className="text-muted-foreground">
          If you are unable to access the app or need assistance deleting your account, contact us
          at{' '}
          <a href="mailto:contact@rallia.ca" className="text-[var(--primary-600)] underline">
            contact@rallia.ca
          </a>
          .
        </p>
      </section>
    </div>
  );
}
