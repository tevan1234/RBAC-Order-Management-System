# 角色定義
ROLES = {
    'ADMIN': 'admin',
    'SALES': 'sales',
    'VIEWER': 'viewer'
}

# 角色特性
ROLE_CAPABILITIES = {
    'admin': {
        'is_read_only': False,
        'can_manage_users': True,
        'can_view_audit_logs': True,
        'can_create_resources': True
    },
    'sales': {
        'is_read_only': False,
        'can_manage_users': False,
        'can_view_audit_logs': False,
        'can_create_resources': True  # 受限於 owner_id
    },
    'viewer': {
        'is_read_only': True,          # 關鍵：純唯讀
        'can_manage_users': False,
        'can_view_audit_logs': False,
        'can_create_resources': False
    }
}

# 權限定義
PERMISSIONS = {
    # Order 相關
    'ORDER_VIEW': ['admin', 'sales', 'viewer'],
    'ORDER_CREATE': ['admin', 'sales'],
    'ORDER_EDIT': ['admin', 'sales'],          # Sales 限自己
    'ORDER_VOID': ['admin'],
    'ORDER_COMPLETE': ['admin', 'sales'],      # Sales 限自己
    
    # Customer 相關
    'CUSTOMER_VIEW': ['admin', 'sales', 'viewer'],
    'CUSTOMER_CREATE': ['admin', 'sales'],
    'CUSTOMER_EDIT': ['admin', 'sales'],       # Sales 限自己
    'CUSTOMER_VOID': ['admin'],
    
    # User Management（僅 Admin）
    'USER_VIEW': ['admin'],
    'USER_CREATE': ['admin'],
    'USER_EDIT': ['admin'],
    'USER_DELETE': ['admin'],
    'USER_MANAGE_ROLE': ['admin'],
    
    # Audit Logs（僅 Admin）
    'AUDITLOG_VIEW': ['admin']
}

# 資源所有權規則
OWNERSHIP_FIELDS = {
    'order': 'owner_id',
    'customer': 'owner_id',
    'user': 'id'  # 使用者只能看/編輯自己
}
