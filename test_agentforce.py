import signal
import sys
import time
import requests
import uuid

class SalesforceAgentAPI:
    def __init__(self, agent_id, access_token, my_domain_url):
        self.agent_id = agent_id
        self.access_token = access_token
        self.my_domain_url = my_domain_url
        self.session_id = None
        # Add this line to initialize sequence_id
        self.sequence_id = 1

    def start_session(self):
        external_session_key = str(uuid.uuid4())

        url = f"https://api.salesforce.com/einstein/ai-agent/v1/agents/{self.agent_id}/sessions"

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.access_token}'
        }

        payload = {
            "externalSessionKey": external_session_key,
            "instanceConfig": {
                "endpoint": f"https://{self.my_domain_url}"
            },
            "streamingCapabilities": {
                "chunkTypes": ["Text"]
            },
            "bypassUser": True
        }

        try:
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            
            response_json = response.json()
            self.session_id = response_json['sessionId']
            return self.session_id

        except requests.exceptions.RequestException as e:
            print(f"Error starting session: {e}")
            raise

    def send_message(self, message):
        if not self.session_id:
            raise Exception("No active session. Call start_session() first.")

        url = f"https://api.salesforce.com/einstein/ai-agent/v1/sessions/{self.session_id}/messages"

        headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {self.access_token}'
        }

        payload = {
            "message": {
                "sequenceId": self.sequence_id,
                "type": "Text",
                "text": message
            }
        }

        try:
            start_time = time.time()
            response = requests.post(url, json=payload, headers=headers)
            response.raise_for_status()
            
            end_time = time.time()
            response_time = end_time - start_time
            
            # Increment sequence ID for next message
            self.sequence_id += 1
            
            # Return response and timing
            response_json = response.json()
            agent_message = response_json['messages'][0]['message']
            return agent_message, response_time

        except requests.exceptions.RequestException as e:
            print(f"Error sending message: {e}")
            raise

    def end_session(self):
        if not self.session_id:
            return

        try:
            url = f"https://api.salesforce.com/einstein/ai-agent/v1/sessions/{self.session_id}"

            headers = {
                'x-session-end-reason': 'UserRequest',
                'Authorization': f'Bearer {self.access_token}'
            }

            response = requests.delete(url, headers=headers)
            response.raise_for_status()
            print("Session ended successfully.")
        except Exception as e:
            print(f"Error ending session: {e}")
        finally:
            self.session_id = None
            self.sequence_id = 1
        
def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully"""
    print("\nInterrupted. Cleaning up...")
    if agent_api and agent_api.session_id:
        agent_api.end_session()
    sys.exit(0)

def main():
    # Replace these with your actual values
    global agent_api  # Make it global so signal handler can access it
    AGENT_ID = '0XxHu000000cYAdKAM'
    ACCESS_TOKEN='eyJ0bmsiOiJjb3JlL3Byb2QvMDBESHUwMDAwME1yblRBTUFaIiwidmVyIjoiMS4wIiwia2lkIjoiQ09SRV9BVEpXVC4wMERIdTAwMDAwTXJuVEEuMTc0Mzc0NTU1ODY0MiIsInR0eSI6InNmZGMtY29yZS10b2tlbiIsInR5cCI6IkpXVCIsImFsZyI6IlJTMjU2In0.eyJzY3AiOiJzZmFwX2FwaSBjaGF0Ym90X2FwaSBhcGkiLCJzdWIiOiJ1aWQ6MDA1SHUwMDAwMFJtN24wSUFCIiwicm9sZXMiOltdLCJpc3MiOiJodHRwczovL2NhMTc0Mzc0MDk5MzU2MC5teS5zYWxlc2ZvcmNlLmNvbSIsImNsaWVudF9pZCI6IjNNVkc5VlRmcEpteGcxeWdxQUkucEg5QzFJMEtXRDlQc0hhcm95Tlp0bGVoVTNzSF9RZ0NxNVQzc2V2ZlBfaWVIMUV1WDMuaHUzSUFXMDNTWGY4V1kiLCJjZHBfdGVuYW50IjoiYTM2MC9wcm9kL2M1Y2U4NDc3YTI2YzQ5ZDA4OTdjMjNlM2UwYWNmOWQ3IiwiYXVkIjpbImh0dHBzOi8vYXBpLnNhbGVzZm9yY2UuY29tIiwiaHR0cHM6Ly9jYTE3NDM3NDA5OTM1NjAubXkuc2FsZXNmb3JjZS5jb20iXSwibmJmIjoxNzQ0MDg3ODI2LCJtdHkiOiJvYXV0aCIsInNmYXBfcmgiOiJib3Qtc3ZjLWxsbTphd3MtcHJvZDgtY2FjZW50cmFsMS9laW5zdGVpbixib3Qtc3ZjLWxsbS9GbG93R3B0OmF3cy1wcm9kMS11c2Vhc3QxL2VpbnN0ZWluLGJvdC1zdmMtbGxtL0VEQzphd3MtcHJvZDEtdXNlYXN0MS9laW5zdGVpbixlaW5zdGVpbi10cmFuc2NyaWJlL0VpbnN0ZWluR1BUOmF3cy1wcm9kOC1jYWNlbnRyYWwxL2VpbnN0ZWluLG12cy9FREM6YXdzLXByb2QxLXVzZWFzdDEvZWluc3RlaW4sZWluc3RlaW4tYWktZ2F0ZXdheS9FaW5zdGVpbkdQVDphd3MtcHJvZDgtY2FjZW50cmFsMS9laW5zdGVpbixlaW5zdGVpbi1haS1nYXRld2F5L0VEQzphd3MtcHJvZDEtdXNlYXN0MS9laW5zdGVpbiIsInNmaSI6IjA5OGMxZTE0ZTU3ZDEyOGZmODAwNTc1MzVkZTg3ODk1ZTNmYTU1MmMxNjUyMGIyZGVmNDNmMmMyZTViNmUzZTMiLCJzZmFwX29wIjoiRWluc3RlaW5IYXdraW5nQzJDRW5hYmxlZCxFR3B0Rm9yRGV2c0F2YWlsYWJsZSxFaW5zdGVpbkdlbmVyYXRpdmVTZXJ2aWNlLFRhYmxlYXVNZXRyaWNCYXNpY3MsU2FsZXNmb3JjZUNvbmZpZ3VyYXRvckVuZ2luZSIsImhzYyI6ZmFsc2UsImNkcF91cmwiOiJodHRwczovL2EzNjAuY2RwLmNkcDMuYXdzLXByb2QxLXVzZWFzdDEuYXdzLnNmZGMuY2wiLCJleHAiOjE3NDQwODk2NDEsImlhdCI6MTc0NDA4Nzg0MX0.dq5h6o98yXUZ6mfnAqWVHBDh7IFJZLnpnLazXSbcQTjyB9UnXrlync9HTb7YKRSUheiOLcFzR7ipYshDeDIEFgdmxi4e9ERAqGHh6rSUZcbcuH3431kKRSRm8PkWIw09VVM8AbOftdjTwBxqTZkHEzzrwKlPtplEZzlf3NIT-j86p2Pd_U4SjwcdReRF6JMY9ronxFfvfH_PU7bvdOqeCwTR8ohNHJovbq1jV7DeX8Fh4ISONnSZreq0fxoZSY0BpZeQTWlI9NLdJD2c4KagPQvvdgDSjw7pPW9XgS7gvromzeQHY1NLR68RRT_djJPyViZ6FZTo5wxgF9mIZ0nseQ'
    MY_DOMAIN_URL = 'ca1743740993560.my.salesforce.com'


     # Register signal handler for clean exit
    signal.signal(signal.SIGINT, signal_handler)

    # Create an instance of the Salesforce Agent API
    agent_api = SalesforceAgentAPI(AGENT_ID, ACCESS_TOKEN, MY_DOMAIN_URL)

    try:
        session_id = agent_api.start_session()
        print(f"Session started with ID: {session_id}")
       # Conversation loop
        while True:
            try:
                # Get user input
                user_message = input("\nYou (type 'exit' to quit): ")

                # Check for exit condition
                if user_message.lower() in ['exit', 'quit', 'q']:
                    break

                # Send message and get response with timing
                agent_response, response_time = agent_api.send_message(user_message)
                
                # Print agent's response with timing information
                print(f"\nAgent (response time: {response_time:.2f} seconds):")
                print(agent_response)

            except Exception as e:
                print(f"An error occurred: {e}")

    except Exception as e:
        print(f"Initial session setup failed: {e}")

    finally:
        # Always try to end the session
        if agent_api and agent_api.session_id:
            agent_api.end_session()

if __name__ == "__main__":
    main()