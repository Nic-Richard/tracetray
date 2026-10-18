import AccountDeletion from "../../../components/AccountDeletion";
import { useSite } from "../../../lib/site";

export default function DeleteAccountScreen() {
  const { closeAccount } = useSite();
  return <AccountDeletion onRequested={closeAccount} />;
}
