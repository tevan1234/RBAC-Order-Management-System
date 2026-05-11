import httpx
import asyncio

async def test_change_password():
    base_url = "http://localhost:8000/api"
    
    # 1. Login with a test user (we can try admin or create a test one)
    # Actually, we need to know an existing user's employee_id and password.
    # Let's use the admin user if we know it. From previous logs, maybe EMP001 with 'test1234' or 'admin123'.
    # I'll just login with EMP001 and password test1234. If it fails, I'll print the error.
    employee_id = "EMP0001"
    password = "test1234"
    new_password = "new_test1234"
    
    async with httpx.AsyncClient() as client:
        print(f"Trying to login with {employee_id}...")
        login_res = await client.post(f"{base_url}/auth/login", json={
            "employee_id": employee_id,
            "password": password
        })
        
        if login_res.status_code != 200:
            print(f"Login failed! Trying new password {new_password}...")
            login_res = await client.post(f"{base_url}/auth/login", json={
                "employee_id": employee_id,
                "password": new_password
            })
            if login_res.status_code != 200:
                print(f"Login failed again! {login_res.text}")
                return
            else:
                # Swap passwords for the test
                password, new_password = new_password, password
                
        token = login_res.json()["access_token"]
        print(f"Login successful! Got token.")
        
        # 2. Change password
        print(f"Trying to change password from {password} to {new_password}...")
        change_res = await client.patch(
            f"{base_url}/auth/change-password",
            json={
                "current_password": password,
                "new_password": new_password
            },
            headers={"Authorization": f"Bearer {token}"}
        )
        
        print(f"Change password response: {change_res.status_code}")
        print(change_res.text)
        
        if change_res.status_code == 200:
            print("Password change successful! Re-logging in to verify...")
            # 3. Verify new login
            verify_res = await client.post(f"{base_url}/auth/login", json={
                "employee_id": employee_id,
                "password": new_password
            })
            if verify_res.status_code == 200:
                print("Verification successful!")
                # Reset password back to original
                token = verify_res.json()["access_token"]
                await client.patch(
                    f"{base_url}/auth/change-password",
                    json={
                        "current_password": new_password,
                        "new_password": password
                    },
                    headers={"Authorization": f"Bearer {token}"}
                )
                print("Reset password back to original.")
            else:
                print(f"Verification failed! {verify_res.text}")

if __name__ == "__main__":
    asyncio.run(test_change_password())
