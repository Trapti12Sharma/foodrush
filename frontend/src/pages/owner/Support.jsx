import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import SupportTicketsPanel from '../../components/SupportTicketsPanel';

// The owner's currently-selected restaurant is silently attached to every ticket
// this page creates — the backend re-verifies ownership regardless, but this
// saves the owner from ever having to type/paste an id.
export default function OwnerSupport() {
  const { selectedRestaurant } = useRestaurantOwner();
  return <SupportTicketsPanel restaurantId={selectedRestaurant?._id} />;
}
