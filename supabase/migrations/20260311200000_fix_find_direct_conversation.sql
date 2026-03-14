-- Fix find_direct_conversation to exclude match-linked conversations
-- Previously, if two players had a singles match chat (conversation_type='direct' + match_id),
-- creating a new direct conversation between them would return the match chat instead,
-- causing the conversation to appear in the Matches tab instead of Direct.

CREATE OR REPLACE FUNCTION find_direct_conversation(p_player1 uuid, p_player2 uuid)
RETURNS uuid AS $$
  SELECT c.id
  FROM conversation c
  JOIN conversation_participant cp1 ON cp1.conversation_id = c.id AND cp1.player_id = p_player1
  JOIN conversation_participant cp2 ON cp2.conversation_id = c.id AND cp2.player_id = p_player2
  WHERE c.conversation_type = 'direct'
    AND c.match_id IS NULL
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
