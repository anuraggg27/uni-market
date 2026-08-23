export function shouldFollowNewMessage(
  isNearBottom: boolean,
  senderId: string,
  currentUserId: string | undefined,
) {
  return isNearBottom || senderId === currentUserId;
}
