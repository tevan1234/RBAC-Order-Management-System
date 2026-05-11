"""test_endpoints.py — 測試所有後端 API 端點"""
import urllib.request, json, sys

BASE = 'http://localhost:8000'

# 取得 token
data = json.dumps({'employee_id': 'EMP5590', 'password': 'admin123'}).encode()
req = urllib.request.Request(BASE + '/api/auth/login', data=data, headers={'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req) as r:
        token = json.loads(r.read())['access_token']
    print('Token: OK')
except Exception as e:
    print('Login FAILED:', e)
    sys.exit(1)

headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
endpoints = ['/api/orders/', '/api/customers/', '/api/products/', '/api/users/', '/api/audit/']

for ep in endpoints:
    req2 = urllib.request.Request(BASE + ep, headers=headers)
    try:
        with urllib.request.urlopen(req2) as r:
            d = json.loads(r.read())
            count = len(d) if isinstance(d, list) else 'object'
            print('OK   ' + ep + ' -> ' + str(count) + ' items')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:100]
        print('FAIL ' + ep + ' -> HTTP ' + str(e.code) + ': ' + body)
    except Exception as e:
        print('ERR  ' + ep + ' -> ' + str(e))
